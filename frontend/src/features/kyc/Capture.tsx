// One image of the wizard (FR-KYC-02; section 5.2): the camera, a preview and a retake. When the
// camera is refused or missing, the wizard says how to allow it and, for documents only, offers a file
// from the device; a selfie is never taken from a file. The view sits in a dark stage with a guide for the card, the
// passport page or the face (docs/design/10_visual.md, section 7.9).
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { FormMessage } from '../../shared/form';
import { cameraProblem, IMAGE_TYPES, MAX_IMAGE_BYTES, stopStream, useCamera, type CameraProblem, type Facing } from './camera';
import { useKycT } from './common';
import styles from './kyc.module.css';

interface Props {
  id: string;
  /** names the image in the preview's alternative text; the step heading names it on screen */
  title: string;
  /** the id of the heading that names this capture */
  labelledBy: string;
  hint: string;
  facing: Facing;
  /** the guide drawn over the camera view: a card, a passport page or an oval for the face */
  frame: 'nid' | 'passport' | 'selfie';
  allowFile: boolean;
  value: Blob | null;
  onChange: (image: Blob | null) => void;
  /** a message about this image from the server (too large, unreadable) */
  error?: string | null;
}

export function Capture({ id, title, labelledBy, hint, facing, frame, allowFile, value, onChange, error }: Props) {
  const { t } = useKycT();
  const camera = useCamera();
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [busy, setBusy] = useState(false);
  // the first frame has arrived: before it the video has no size, and a photo taken then would fail (U8-11)
  const [ready, setReady] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream;
  }, [stream]);
  useEffect(() => () => stopStream(stream), [stream]);

  const start = async () => {
    setProblem(null);
    setReady(false);
    setBusy(true);
    try {
      setStream(await camera.open(facing));
    } catch (e) {
      setProblem(cameraProblem(e));
    } finally {
      setBusy(false);
    }
  };

  const take = async () => {
    if (!video.current || busy) return;
    setBusy(true);
    try {
      const image = await camera.capture(video.current);
      stopStream(stream);
      setStream(null);
      onChange(image);
    } catch {
      setProblem('failed');
    } finally {
      setBusy(false);
    }
  };

  const fromFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!(IMAGE_TYPES as readonly string[]).includes(f.type)) { setFileError(t('capture.file_type')); return; }
    if (f.size > MAX_IMAGE_BYTES) { setFileError(t('capture.too_large')); return; }
    setFileError(null);
    onChange(f);
  };

  const shown = error ?? fileError;
  return (
    <div role="group" aria-labelledby={labelledBy} className={styles.capture}>
      <p>{hint}</p>
      {shown && <FormMessage kind="error">{shown}</FormMessage>}
      {/* the camera view, darkened around the guide with the instruction in it (AC-KYC-2) */}
      <div className={`${styles.stage} ${frame === 'selfie' ? styles.selfieStage : ''}`}>
        {value
          ? <Preview image={value} alt={t('capture.preview_alt', { what: title })} />
          : stream && <video ref={video} className={styles.video} autoPlay playsInline muted aria-label={t('capture.camera_view')} onLoadedData={() => setReady(true)} />}
        {!value && <span className={frame === 'selfie' ? styles.oval : styles.card} aria-hidden="true" />}
        {!value && <p className={styles.frameText}>{t(`frame.${frame}`)}</p>}
      </div>
      <div className={styles.nav}>
        {value
          ? <button type="button" className={styles.secondary} onClick={() => { onChange(null); void start(); }}>{t('capture.retake')}</button>
          : stream
            ? <button type="button" className={styles.primary} onClick={() => void take()} disabled={busy || !ready}>{t('capture.take')}</button>
            : <button type="button" className={styles.primary} onClick={() => void start()} disabled={busy}>{t('capture.start')}</button>}
      </div>
      {problem && !value && (
        <FormMessage kind="info">
          <p>{t(`capture.problem.${problem}`)}</p>
          <p>{allowFile ? t('capture.file_offer') : t('capture.selfie_needs_camera')}</p>
        </FormMessage>
      )}
      {allowFile && !value && problem && (
        <div className={styles.file}>
          <input id={`${id}-file`} type="file" accept={IMAGE_TYPES.join(',')} onChange={fromFile} />
          <label htmlFor={`${id}-file`}>{t('capture.choose_file')}</label>
        </div>
      )}
    </div>
  );
}

/** The image held in memory, shown through an object URL that is released when it changes. */
export function Preview({ image, alt }: { image: Blob; alt: string }) {
  const url = useMemo(() => URL.createObjectURL(image), [image]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img className={styles.preview} src={url} alt={alt} />;
}
