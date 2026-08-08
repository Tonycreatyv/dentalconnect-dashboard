-- READ ONLY: runtime content-snapshot compatibility for canonical basket offers.
select table_name, column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'referral_basket_offers'
  and column_name = 'contents_snapshot';
