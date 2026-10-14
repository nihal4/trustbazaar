import { useState } from 'react';
import { api } from '../api/client';

// FR-ACC-05, FR-ACC-06, SEC-SES-03: email/phone + password auth. On success the backend sets an
// HttpOnly session cookie (never store the token in localStorage, per SEC-SES-03); redirect based on
// kycStatus (users who are not yet verified can browse/chat only).
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: POST /auth/login, store token, redirect on success.
    await api.post('/auth/login', { email, password }).catch(() => {
      /* TODO: surface a real error message */
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>Log In</h1>
      <label>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
      </label>
      <label>
        Password
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
      </label>
      <button type="submit">Log In</button>
    </form>
  );
}
