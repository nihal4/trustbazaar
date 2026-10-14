import { useParams } from 'react-router-dom';

// FR-AUC-01–FR-AUC-18, NFR-PERF-03, NFR-USE-01: live bid feed, countdown, proxy-bid form, and
// the anti-sniping/proxy-bidding explainer a first-time bidder needs to see
// without leaving this page. Should subscribe to the 'auction:join' socket
// event defined in backend/src/realtime/realtime.gateway.ts.
export default function ListingDetail() {
  const { id } = useParams();
  return (
    <div>
      <h1>Listing {id}</h1>
      <p>TODO: fetch listing detail, render live auction state or fixed-price buy button.</p>
    </div>
  );
}
