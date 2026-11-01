// The token of an e-mailed link (`/reset-password#token=...`, `/verify-email#token=...`; Decisions log,
// U1-03 and U1-05). It is read once from the fragment, which never reaches a server, and the fragment is
// then removed from the address bar and the history entry.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function readLinkToken(hash: string): string | null {
  const v = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return v && TOKEN.test(v) ? v : null;
}

export function useLinkToken(): string | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => readLinkToken(location.hash));
  useEffect(() => {
    if (location.hash) navigate(location.pathname + location.search, { replace: true });
  }, [location, navigate]);
  return token;
}
