// Opening a conversation from a listing or an order (FR-CHT-01; U8-13): POST /listings/{id}/threads finds the
// caller's thread with the seller, or opens it, and the chat screen opens. Shared because the listing and order
// screens use it and features do not import each other (section 3.2).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from './api';

export function useOpenThread(): { open: (listingId: string) => void; busy: boolean; error: unknown } {
  const api = useApi();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const open = (listingId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    (api.post(`/listings/${encodeURIComponent(listingId)}/threads`, {}) as Promise<{ id: string }>).then(
      ({ id }) => navigate(`/messages/${encodeURIComponent(id)}`),
      (e: unknown) => {
        setError(e);
        setBusy(false);
      },
    );
  };
  return { open, busy, error };
}
