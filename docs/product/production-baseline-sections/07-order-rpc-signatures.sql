-- READ ONLY: order RPC identities, arguments, return types, and security mode.
select n.nspname as schema_name,
       p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_referral_order', 'update_referral_order_status')
order by p.proname;
