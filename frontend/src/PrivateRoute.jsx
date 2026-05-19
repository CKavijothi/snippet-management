import { useAuth } from "./AuthContext";
import AuthPage from "./AuthPage";

export default function PrivateRoute({ children }) {
  const { user, isTokenValid } = useAuth();
  const reason = sessionStorage.getItem("logout_reason");

  if (!user || !isTokenValid()) {
    return <AuthPage expiredMessage={reason === "expired" ? "Your session expired. Please sign in again." : ""} />;
  }

  return children;
}