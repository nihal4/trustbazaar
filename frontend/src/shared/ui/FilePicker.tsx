// The choice of a file or files (U11-19): one ruled cell, the action on the left and what is chosen on the right, as the action rows of the order rail. The browser's own input stays in the page,
// out of sight, so the keyboard, a screen reader and the picker of the phone work as they always did; the cell is its label and shows the focus.
// The words come in as props (`action`, `status`): the page knows what is being picked and in which language.
import type { ChangeEvent, ReactNode, Ref } from 'react';
import { cx } from './cx';
import styles from './filePicker.module.css';

export interface FilePickerProps {
  id: string;
  /** what the cell says: "Choose files" */
  action: ReactNode;
  /** what is chosen: "No file chosen", "2 files"; leave out when the file is used at once and nothing stays chosen */
  status?: ReactNode;
  accept: string;
  multiple?: boolean;
  /** a phone opens its camera: 'environment' for the back one */
  capture?: 'user' | 'environment';
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  'aria-describedby'?: string;
  /** the files the person chose; the input is given too, so the page can empty it to allow the same file again */
  onFiles: (files: FileList | null, input: HTMLInputElement) => void;
  className?: string;
}

export function FilePicker({ id, action, status, accept, multiple, capture, disabled, inputRef, onFiles, className, ...aria }: FilePickerProps) {
  return (
    <div className={cx(styles.picker, disabled && styles.disabled, className)}>
      <input
        {...aria}
        ref={inputRef}
        id={id}
        className={styles.input}
        type="file"
        accept={accept}
        multiple={multiple}
        capture={capture}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onFiles(e.target.files, e.target)}
      />
      <label htmlFor={id} className={styles.cell}>
        <span className={styles.action}>{action}</span>
        {status != null && <span className={styles.status}>{status}</span>}
      </label>
    </div>
  );
}
