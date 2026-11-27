/** Joins the class names that are set: cx(styles.button, big && styles.lg, undefined) -> "button lg". */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
