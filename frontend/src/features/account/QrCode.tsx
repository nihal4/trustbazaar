// The QR code of the authenticator enrolment (Unit 1 section 6.5: the otpauth:// URI "shown as a QR
// code"). Drawn here in the browser, as one SVG path built by React from qrcode-generator 2.0.4 (MIT;
// Decisions log, U8-12): no HTML string, no canvas, no data URL, no image service. The code carries
// the TOTP secret, so it never leaves the page. Loaded lazily by the security page only.
import qrcode from 'qrcode-generator';
import styles from './account.module.css';

const QUIET = 4;   // modules of empty border, as the QR standard asks

/** The dark modules of a QR code for `text`, as an SVG path in module units. */
export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
  }
  return { size: n + 2 * QUIET, d };
}

/** `label` names the code for screen readers; it must not contain the secret. */
export default function QrCode({ text, label }: { text: string; label: string }) {
  const { size, d } = qrPath(text);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} width="232" height="232"
      shapeRendering="crispEdges" className={styles.qr}>
      <path d={d} fill="#000" />
    </svg>
  );
}
