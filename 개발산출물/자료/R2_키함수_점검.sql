-- R2 점검: docs/04 SQL을 적용한 DB에서 키 함수·권한·Vault 정리를 확인한다 (P0-2 pgTAP로 옮길 원본)
-- 실행: docs/04의 ```sql 블록을 순서대로 이어 붙이고 이 파일을 뒤에 붙여 한 트랜잭션으로 실행, 끝에 rollback
--   (명령은 개발산출물/결과/R2_설계개정.md 9절)
-- 키 값은 형식만 맞춘 가짜 값이다.
\echo '=== 권한 점검 (모두 f 여야 함) ==='
select has_function_privilege('anon','public.get_notion_key(uuid, text)','execute') anon_get,
       has_function_privilege('authenticated','public.get_notion_key(uuid, text)','execute') auth_get,
       has_function_privilege('authenticated','public.get_gemini_key(uuid, text)','execute') auth_gem,
       has_function_privilege('anon','public.save_notion_key(text, text, text, text, text)','execute') anon_save,
       has_function_privilege('authenticated','private.put_key(uuid, text, text, text, jsonb)','execute') auth_put,
       has_function_privilege('anon','public.add_practice(uuid, date, integer, integer, numeric, numeric, numeric)','execute') anon_add;
select has_function_privilege('authenticated','public.save_notion_key(text, text, text, text, text)','execute') auth_save_t,
       has_function_privilege('service_role','public.get_notion_key(uuid, text)','execute') sr_get_t;
\echo '=== 사용자 A 로 키 저장 ==='
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000a','a@test.local','{}');
select count(*) as profiles_rows from public.profiles;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',true);
select * from public.save_notion_key('ulevelp','ntn_abcdefghijklmnopqrstuvwxyz1234','0123456789abcdef0123456789abcdef','fedcba9876543210fedcba9876543210');
select * from public.save_notion_key('ulevelp',null,'0123456789abcdef0123456789abcdef','fedcba9876543210fedcba9876543210','00000000000000000000000000000001');
select * from public.save_notion_key('guitar-practice','secret_ZZZZZZZZZZZZZZZZZZZZZZZZ9999','0123456789abcdef0123456789abcdef','fedcba9876543210fedcba9876543210');
select * from public.save_gemini_key('ulevelp','AIzaSyA0123456789abcdefghijklmnopqrstu', null);
select app_id, provider, hint, config from public.integrations order by 1,2;
\echo '--- 잘못된 입력 (각각 오류여야 함) ---'
\set ON_ERROR_STOP 0
savepoint s1; select public.save_notion_key('ulevelp','bad_token','0123456789abcdef0123456789abcdef','fedcba9876543210fedcba9876543210'); rollback to s1;
savepoint s2; select public.save_gemini_key('guitar-practice',null,null); rollback to s2;
savepoint s3; select secret_id from public.integrations; rollback to s3;
savepoint s4; select * from public.get_notion_key('00000000-0000-0000-0000-00000000000a','ulevelp'); rollback to s4;
savepoint s5; insert into public.integrations (user_id, app_id, provider, secret_id, hint) values ('00000000-0000-0000-0000-00000000000a','ulevelp','gemini',gen_random_uuid(),'x'); rollback to s5;
savepoint s6; update public.notion_sync set enabled = true; rollback to s6;
\set ON_ERROR_STOP 1
select * from public.sync_status();
reset role;
\echo '=== service_role 로 원문 조회 ==='
set local role service_role;
select left(token,8) tok, songs_db, notes_db from public.get_notion_key('00000000-0000-0000-0000-00000000000a','ulevelp');
reset role;
select count(*) as vault_rows from vault.secrets where name like '%:00000000-0000-0000-0000-00000000000a';
\echo '=== 노션 키 해제 → Vault 행 삭제 ==='
set local role authenticated;
delete from public.integrations where app_id='ulevelp' and provider='notion';
reset role;
select count(*) as vault_rows_after from vault.secrets where name like '%:00000000-0000-0000-0000-00000000000a';
\echo '=== 계정 삭제 cascade → Vault 전부 삭제 ==='
delete from auth.users where id='00000000-0000-0000-0000-00000000000a';
select count(*) as vault_rows_final from vault.secrets where name like '%:00000000-0000-0000-0000-00000000000a';

