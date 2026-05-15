import { useAuth } from "./AuthContext";
import AuthPage from "./AuthPage";

export default function PrivateRoute({ children }) {
  const { user, isTokenValid } = useAuth();
  if (!user || !isTokenValid()) return <AuthPage />;
  return children;
}