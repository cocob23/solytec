import { Navigate } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';

export const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-6 text-center text-sm text-gray-600">Cargando sesión…</div>;
  return session ? children : <Navigate to="/login" replace />;
};

export const RequireAdmin = ({ children }: { children: JSX.Element }) => {
  const { userRow, loading } = useAuth();
  if (loading) return <div className="p-6 text-center text-sm text-gray-600">Cargando sesión…</div>;
  if (!userRow) return <Navigate to="/login" replace />;
  return userRow.role === 'admin' ? children : <Navigate to="/" replace />;
};
