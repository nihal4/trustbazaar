// A table that stacks on a small screen (U11-05): columns across on a desktop; on a phone each row becomes a block and each cell shows its column's name beside its value, so a table never
// needs a sideways scroll (NFR-USE-05). The columns say how to draw a cell from a row; the page gives rows and words.
import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './table.module.css';

export interface TableColumn<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: 'start' | 'end';
}

interface TableProps<Row> {
  columns: TableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** what the table is, for a screen reader */
  caption: string;
  className?: string;
}

export function Table<Row>({ columns, rows, rowKey, caption, className }: TableProps<Row>) {
  return (
    <table className={cx(styles.table, className)}>
      <caption className={styles.caption}>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className={c.align === 'end' ? styles.end : undefined}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((c) => (
              <td key={c.key} data-label={c.header} className={c.align === 'end' ? styles.end : undefined}>
                {c.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
