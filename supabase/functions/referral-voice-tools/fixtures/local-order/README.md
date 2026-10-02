# Local grocery-order compatibility fixture

These files are local-test-only copies of the confirmed production order
foundation, creation RPC, and order-state migration. They are intentionally
outside `supabase/migrations` and must never be pushed to a remote database.

Apply them in numeric order to a disposable local Supabase database. The
prerequisite file creates only the shared organization/membership contract
needed by the copied production definitions. The sole compatibility correction
in the copied creation RPC declares its loop variable so the historical source
compiles locally; order behavior is otherwise unchanged.
