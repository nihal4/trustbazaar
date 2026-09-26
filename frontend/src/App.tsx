import { Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import Login from './pages/Login';
import KycWizard from './pages/KycWizard';
import ListingDetail from './pages/ListingDetail';

export default function App() {
  return (
    <div>
      <nav style={{ padding: '1rem', borderBottom: '1px solid #ddd' }}>
        <Link to="/" style={{ marginRight: '1rem' }}>
          TrustBazaar
        </Link>
        <Link to="/login" style={{ marginRight: '1rem' }}>
          Login
        </Link>
        <Link to="/kyc">KYC</Link>
      </nav>

      <main style={{ padding: '1.5rem' }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/kyc" element={<KycWizard />} />
          <Route path="/listings/:id" element={<ListingDetail />} />
        </Routes>
      </main>
    </div>
  );
}
