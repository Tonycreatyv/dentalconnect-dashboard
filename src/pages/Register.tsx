import { Navigate, useLocation } from "react-router-dom";

// Legacy entry point retained only for bookmarks and campaign links. Account
// creation and tenant provisioning are now /signup -> /onboarding.
export default function Register() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const next = new URLSearchParams();
  const campaign = params.get("campaign");
  const returnTo = params.get("return_to");
  if (campaign && campaign.length <= 120) next.set("campaign", campaign);
  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    next.set("return_to", returnTo);
  }
  const search = next.toString();
  return <Navigate replace to={`/signup${search ? `?${search}` : ""}`} />;
}
