export type ToastTone = "success" | "info" | "warning" | "danger";

export interface ToastMessage {
  id: string;
  message: string;
  tone: ToastTone;
}

const dismissAfter: Record<ToastTone, number> = {
  success: 4_000,
  info: 5_000,
  warning: 8_000,
  danger: 8_000,
};

/**
 * Transient confirmation for actions whose effect happens off-screen — a file
 * written to disk, a thread deleted from a list you are not looking at.
 * Anything the user can already see the result of should not raise a toast.
 */
export class ToastQueue {
  items = $state<ToastMessage[]>([]);

  #nextId = 0;
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  show(message: string, tone: ToastTone = "success"): string {
    const id = `toast-${++this.#nextId}`;
    this.items.push({ id, message, tone });
    this.#timers.set(
      id,
      setTimeout(() => this.dismiss(id), dismissAfter[tone]),
    );
    return id;
  }

  dismiss(id: string): void {
    const timer = this.#timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.#timers.delete(id);
    this.items = this.items.filter((item) => item.id !== id);
  }

  clear(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.items = [];
  }
}

export const toasts = new ToastQueue();
