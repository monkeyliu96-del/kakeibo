-- 记账本 kakeibo · Supabase 数据库结构
-- 在新的 Supabase 项目里:SQL Editor → 粘贴整个文件 → Run,就能建好后端。
-- 然后把 index.html 里的 SUPA_URL / SUPA_KEY 换成新项目的 URL 和 publishable key。
-- (导出自线上项目,2026-11-21)

-- ===== 表 =====
create table if not exists public.kakeibo_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.kakeibo_history (
  user_id uuid not null,
  day date not null,
  data jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table if not exists public.kakeibo_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.kakeibo_inbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amt integer not null,
  merchant text not null default '',
  card text not null default '',
  at timestamptz not null default now(),
  src text not null default 'ap',   -- ap=Apple Pay, ml=邮件, pp=PayPay付款/转出截图, pi=收款截图, as=资产截图
  ext text
);
create index if not exists kakeibo_inbox_user on public.kakeibo_inbox using btree (user_id);

-- ===== 行级权限:每个人只能读写自己的数据 =====
alter table public.kakeibo_state enable row level security;
alter table public.kakeibo_history enable row level security;
alter table public.kakeibo_tokens enable row level security;
alter table public.kakeibo_inbox enable row level security;

create policy "own row: select" on public.kakeibo_state for select to authenticated using ((select auth.uid()) = user_id);
create policy "own row: insert" on public.kakeibo_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own row: update" on public.kakeibo_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own row: delete" on public.kakeibo_state for delete to authenticated using ((select auth.uid()) = user_id);
create policy "own history: select" on public.kakeibo_history for select to authenticated using ((select auth.uid()) = user_id);
-- 开启加密后,App 会删掉自己备份里加密前的明文
create policy "own history: delete" on public.kakeibo_history for delete to authenticated using ((select auth.uid()) = user_id);
create policy "tok_own" on public.kakeibo_tokens for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "inbox_sel" on public.kakeibo_inbox for select to authenticated using (user_id = (select auth.uid()));
create policy "inbox_del" on public.kakeibo_inbox for delete to authenticated using (user_id = (select auth.uid()));

-- ===== 云端自动备份:每天保留一份,保留 7 天 =====
create or replace function public.kakeibo_keep_history()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare d date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if old.data is distinct from new.data then
    insert into public.kakeibo_history(user_id, day, data) values (old.user_id, d, old.data)
      on conflict (user_id, day) do nothing;
    delete from public.kakeibo_history where user_id = old.user_id and day < d - 7;
  end if;
  return new;
end $function$;

drop trigger if exists kakeibo_keep_history on public.kakeibo_state;
create trigger kakeibo_keep_history before update on public.kakeibo_state
  for each row execute function public.kakeibo_keep_history();

-- ===== 自动记账收件箱:Apple Pay 快捷指令 / Gmail 脚本调用 =====
create or replace function public.ap_push(tok text, amount text, merchant text default ''::text, card text default ''::text, at text default null::text, src text default 'ap'::text, ext text default null::text)
 returns json language plpgsql security definer set search_path to ''
as $function$
declare uid uuid; a numeric; n int; t timestamptz;
begin
  select user_id into uid from public.kakeibo_tokens where token = tok;
  if uid is null then return json_build_object('ok', false, 'error', 'bad token'); end if;
  select count(*) into n from public.kakeibo_inbox where user_id = uid and kakeibo_inbox.at > now() - interval '1 day';
  if n >= 300 then return json_build_object('ok', false, 'error', 'too many'); end if;
  a := nullif(regexp_replace(coalesce(amount, ''), '[^0-9.]', '', 'g'), '')::numeric;
  if a is null or a <= 0 or a > 10000000 then return json_build_object('ok', false, 'error', 'bad amount'); end if;
  begin t := nullif(at, '')::timestamptz; exception when others then t := null; end;
  if t is null or t > now() + interval '1 day' or t < now() - interval '60 days' then t := now(); end if;
  insert into public.kakeibo_inbox(user_id, amt, merchant, card, at, src, ext)
    values (uid, round(a)::int, left(coalesce(merchant, ''), 120), left(coalesce(card, ''), 60), t,
            case when src = 'ml' then 'ml' else 'ap' end, left(ext, 200));
  return json_build_object('ok', true, 'amt', round(a)::int);
end $function$;

-- ===== 截图识别 =====
create or replace function public.ss_num(t text)
 returns numeric language sql immutable set search_path to ''
as $function$ select nullif(regexp_replace(coalesce(t,''), '[^0-9.]', '', 'g'), '')::numeric $function$;

-- 资产截图:返回 [{key,name,val}],认不出返回 []
create or replace function public.ss_assets(txt text)
 returns json language plpgsql immutable set search_path to ''
as $function$
declare s text; seg text; it jsonb := '[]'::jsonb; v numeric; p int;
begin
  s := left(normalize(coalesce(txt, ''), nfkc), 6000);
  /* ゆうちょ:現在高 → 现金 */
  if s ~ '現在高' then
    seg := substring(s from '現在高([\s\S]{0,80})');
    select public.ss_num(x[1]) into v from regexp_matches(seg, '[¥￥]\s*([0-9][0-9,]*)', 'g') as x limit 1;
    if v is null then select public.ss_num(x[2]) into v from regexp_matches(seg, '(^|[^-0-9,.])([0-9]{1,3}(?:,[0-9]{3})+)(?![0-9.])', 'g') as x limit 1; end if;
    if v >= 0 then it := it || jsonb_build_object('key','jpb','name','ゆうちょ','val',round(v)); end if;
    return it::json;
  end if;
  /* PayPay ウォレット */
  if s ~ 'PayPay\s*資産' or (s ~ 'ウォレット' and s ~ 'PayPay\s*証券') then
    /* PayPay証券:金额后面不远处跟着「±○円 (±○%)」的评价损益 */
    v := public.ss_num((regexp_match(s, '([0-9][0-9,]*)\s*円[^0-9円%]{0,24}[-+−]?\s*[0-9][0-9,]*\s*円\s*[(（]\s*[-+−]?[0-9.]+\s*%'))[1]);
    if v > 0 then it := it || jsonb_build_object('key','pps','name','PayPay証券','val',round(v)); end if;
    /* PayPay残高:「あと○円」(使える金額) 之后出现的第一个金额;没有卡片区时取「PayPay残高」后面的金额 */
    v := null;
    p := regexp_instr(s, 'あと\s*[0-9][0-9,]*\s*円', 1, 1, 1);
    if p > 0 then v := public.ss_num((regexp_match(substr(s, p), '([0-9][0-9,]*)\s*円'))[1]); end if;
    if v is null then
      p := regexp_instr(s, 'PayPay\s*残高', 1, 1, 1);
      if p > 0 then v := public.ss_num((regexp_match(substr(s, p, 60), '([0-9][0-9,]*)\s*円'))[1]); end if;
    end if;
    if v >= 0 then it := it || jsonb_build_object('key','ppb','name','PayPay残高','val',round(v)); end if;
    return it::json;
  end if;
  /* 证券 App「総合サマリー」 */
  if s ~ '評価額合計' then
    seg := substring(s from '評価額合計([\s\S]{0,160})');
    select public.ss_num(x[2]) into v from regexp_matches(seg, '(^|[^-0-9,/:.])([0-9]{1,3}(?:,[0-9]{3})+)(?![0-9/:])', 'g') as x limit 1;
    if v > 0 then it := it || jsonb_build_object('key','brk','name','证券账户','val',round(v)); end if;
    return it::json;
  end if;
  /* Binance 等 */
  if s ~ '(总资产估值|總資產估值|総資産評価額|推定残高|Estimated Balance|Total Balance)' then
    seg := substring(s from '(?:总资产估值|總資產估值|総資産評価額|推定残高|Estimated Balance|Total Balance)([\s\S]{0,120})');
    select public.ss_num(x[1]) into v from regexp_matches(seg, '[¥￥]\s*([0-9][0-9,]*(?:\.[0-9]+)?)', 'g') as x limit 1;
    if v is null then select public.ss_num(x[2]) into v from regexp_matches(seg, '(^|[^-0-9,])([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)', 'g') as x limit 1; end if;
    if v > 0 then it := it || jsonb_build_object('key','bnb','name','Binance','val',round(v)); end if;
    return it::json;
  end if;
  return '[]'::json;
end $function$;

-- PayPay 付款详情页截图 → 一笔支出
create or replace function public.ss_parse(txt text)
 returns json language plpgsql immutable set search_path to ''
as $function$
declare s text; pat text := '(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*時\s*(\d{1,2})\s*分';
  m text[]; p0 int; p1 int; pre text; post text; a text[]; r text[]; ls text[]; l text; keep text[] := '{}'; mer text; card text; t timestamptz;
begin
  s := left(normalize(coalesce(txt, ''), nfkc), 6000);
  m := regexp_match(s, pat);
  if m is null then return json_build_object('ok', false, 'error', '没找到交易时间,请截 PayPay 的付款详情页'); end if;
  if s !~ '支払い(完了|受付)' then return json_build_object('ok', false, 'error', '这张图不是付款记录'); end if;
  p0 := regexp_instr(s, pat); p1 := regexp_instr(s, pat, 1, 1, 1);
  pre := left(s, p0 - 1); post := substr(s, p1);
  t := make_timestamptz(m[1]::int, m[2]::int, m[3]::int, m[4]::int, m[5]::int, 0, 'Asia/Tokyo');
  a := regexp_match(post, '([0-9][0-9,]*)\s*円');
  if a is null then a := regexp_match(post, '支払い合計\D{0,6}([0-9][0-9,]*)'); end if;
  if a is null then return json_build_object('ok', false, 'error', '没找到金额'); end if;
  r := regexp_match(post, '取引番号\D{0,12}([0-9 ]{15,40})');
  /* 店名:时间那一行前面的最后一两行,去掉状态栏(时间、5G、电量等) */
  foreach l in array regexp_split_to_array(pre, '\s*\n\s*') loop
    l := btrim(l);
    if l = '' or l ~ '^[0-9:.%\s]+$' or l ~* '^(5G|4G|LTE|wi-?fi)$' or length(l) < 2 then continue; end if;
    keep := keep || l;
  end loop;
  if cardinality(keep) >= 2 and keep[cardinality(keep)] ~ '店$' then
    mer := keep[cardinality(keep) - 1] || ' ' || keep[cardinality(keep)];
  elsif cardinality(keep) >= 1 then mer := keep[cardinality(keep)];
  else mer := ''; end if;
  card := case when post ~ 'クレジット|カード' then 'PayPayカード' when post ~ '残高' then 'PayPay残高' else 'PayPayカード' end;
  return json_build_object('ok', true, 'amt', replace(a[1], ',', '')::int, 'merchant', left(mer, 120), 'card', card,
    'at', t, 'ext', nullif(replace(coalesce(r[1], ''), ' ', ''), ''));
end $function$;

-- PayPay 送る/受け取る 详情页:{ok,dir:'out'|'in',amt,name,at,ext};不是转账页返回 null
create or replace function public.ss_transfer(txt text) returns json
language plpgsql immutable set search_path to '' as $function$
declare s text; pat text := '(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*時\s*(\d{1,2})\s*分';
  dir text; nm text; m text[]; p1 int; a text[]; r text[];
begin
  s := left(normalize(coalesce(txt, ''), nfkc), 6000);
  if s ~ 'さんに送る' then dir := 'out'; nm := (regexp_match(s, '([^\n]{1,40}?)\s*さんに送る'))[1];
  elsif s ~ 'さんから(受け取る|受け取り|もらう|送られ)' or s ~ 'さんから' and s ~ '受け取' then dir := 'in'; nm := (regexp_match(s, '([^\n]{1,40}?)\s*さんから'))[1];
  else return null; end if;
  m := regexp_match(s, pat);
  if m is null then return json_build_object('ok', false, 'error', '没找到转账时间'); end if;
  p1 := regexp_instr(s, pat, 1, 1, 1);
  a := regexp_match(substr(s, p1), '([0-9][0-9,]*)\s*円');
  if a is null then return json_build_object('ok', false, 'error', '没找到金额'); end if;
  r := regexp_match(s, '取引番号\D{0,12}([0-9 ]{15,40})');
  if r is null then r := regexp_match(s, '(?:^|[^0-9])([0-9]{18,24})(?:[^0-9]|$)'); end if;
  return json_build_object('ok', true, 'dir', dir, 'amt', replace(a[1], ',', '')::int, 'name', btrim(coalesce(nm, '')),
    'at', make_timestamptz(m[1]::int, m[2]::int, m[3]::int, m[4]::int, m[5]::int, 0, 'Asia/Tokyo'),
    'ext', nullif(replace(coalesce(r[1], ''), ' ', ''), ''));
end $function$;

-- 快捷指令「截图 → 识别文字」调用的入口:转账 → 资产截图 → 付款截图
create or replace function public.ss_push(tok text, txt text)
 returns json language plpgsql security definer set search_path to ''
as $function$
declare uid uuid; n int; j json; e text; amt int; a json; x json; names text := ''; tr json; sr text;
begin
  select user_id into uid from public.kakeibo_tokens where token = tok;
  if uid is null then return json_build_object('ok', false, 'msg', '密钥不对,请重新复制 tok'); end if;
  select count(*) into n from public.kakeibo_inbox where user_id = uid and kakeibo_inbox.at > now() - interval '1 day';
  if n >= 300 then return json_build_object('ok', false, 'msg', '今天记得太多了,请稍后再试'); end if;
  /* 转账(送る → 支出 src=pp;受け取る → 收入 src=pi) */
  tr := public.ss_transfer(txt);
  if tr is not null then
    if not (tr->>'ok')::boolean then return json_build_object('ok', false, 'msg', '没记上:' || (tr->>'error')); end if;
    amt := (tr->>'amt')::int; e := tr->>'ext'; sr := case when tr->>'dir' = 'in' then 'pi' else 'pp' end;
    if amt is null or amt <= 0 or amt > 10000000 then return json_build_object('ok', false, 'msg', '没记上:金额不对'); end if;
    if (e is not null and exists (select 1 from public.kakeibo_inbox where user_id = uid and src = sr and ext = e))
       or (e is null and exists (select 1 from public.kakeibo_inbox where user_id = uid and src = sr and kakeibo_inbox.amt = (tr->>'amt')::int and kakeibo_inbox.at = (tr->>'at')::timestamptz)) then
      return json_build_object('ok', true, 'msg', '这笔已经记过了');
    end if;
    insert into public.kakeibo_inbox(user_id, amt, merchant, card, at, src, ext)
      values (uid, amt, left(tr->>'name', 120), 'PayPay残高', (tr->>'at')::timestamptz, sr, e);
    return json_build_object('ok', true, 'msg', case when sr = 'pi' then '已记收入:' else '已记转账:' end || coalesce(nullif(tr->>'name', ''), 'PayPay') || ' ' || amt || '円');
  end if;
  if normalize(coalesce(txt,''), nfkc) !~ '支払い(完了|受付)' then
    a := public.ss_assets(txt);
    if json_array_length(a) > 0 then
      for x in select * from json_array_elements(a) loop
        if (x->>'val')::numeric > 0 and (x->>'val')::numeric < 100000000000 then
          insert into public.kakeibo_inbox(user_id, amt, merchant, card, at, src, ext)
            values (uid, least((x->>'val')::numeric, 2000000000)::int, x->>'name', '', now(), 'as', x->>'key');
          names := names || case when names = '' then '' else '、' end || (x->>'name') || ' ¥' || to_char((x->>'val')::numeric, 'FM999,999,999,999');
        end if;
      end loop;
      return json_build_object('ok', true, 'msg', '已更新资产:' || names);
    end if;
  end if;
  j := public.ss_parse(txt);
  if not (j->>'ok')::boolean then return json_build_object('ok', false, 'msg', '没记上:' || (j->>'error')); end if;
  amt := (j->>'amt')::int; e := j->>'ext';
  if amt is null or amt <= 0 or amt > 10000000 then return json_build_object('ok', false, 'msg', '没记上:金额不对'); end if;
  if e is not null and exists (select 1 from public.kakeibo_inbox where user_id = uid and src = 'pp' and ext = e) then
    return json_build_object('ok', true, 'msg', '这笔已经记过了');
  end if;
  insert into public.kakeibo_inbox(user_id, amt, merchant, card, at, src, ext)
    values (uid, amt, j->>'merchant', j->>'card', (j->>'at')::timestamptz, 'pp', e);
  return json_build_object('ok', true, 'msg', '已记账:' || coalesce(nullif(j->>'merchant', ''), 'PayPay') || ' ' || amt || '円');
end $function$;

-- 兼容:快捷指令填的是 ap_push 网址但发的是截图文字(tok + txt)时,转给 ss_push
create or replace function public.ap_push(tok text, txt text)
 returns json language sql security definer set search_path to ''
as $function$ select public.ss_push(tok, txt) $function$;

-- ===== 调用权限 =====
revoke all on function public.ss_parse(text) from public, anon, authenticated;
revoke all on function public.ss_assets(text) from public, anon, authenticated;
revoke all on function public.ss_num(text) from public, anon, authenticated;
revoke all on function public.ss_transfer(text) from public, anon, authenticated;
revoke all on function public.kakeibo_keep_history() from public, anon, authenticated;
revoke all on function public.ss_push(text, text) from public;
revoke all on function public.ap_push(text, text) from public;
grant execute on function public.ss_push(text, text) to anon, authenticated;
grant execute on function public.ap_push(text, text) to anon, authenticated;
grant execute on function public.ap_push(text, text, text, text, text, text, text) to anon, authenticated;
