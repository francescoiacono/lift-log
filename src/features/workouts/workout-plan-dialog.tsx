import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { styles as controls } from "./workout-plan-controls.styles";
import { styles } from "./workout-plan-dialog.styles";

/** Accessible plan dialog with a separately scrolling body and reachable actions. */
type PlanDialogProps = {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Handles dismissal and requested visibility changes. */
  onOpenChange: (open: boolean) => void;
  /** Dialog heading announced on entry. */
  title: string;
  /** Additional context announced on entry. */
  description: string;
  /** Accessible label for the dismiss button. */
  closeLabel: string;
  /** Main dialog content. */
  children: ReactNode;
  /** Persistent footer actions. */
  footer?: ReactNode;
  /** Whether to fill the viewport on phones. */
  fullScreen?: boolean;
  /** Whether dismissal is temporarily unavailable. */
  busy?: boolean;
  /** Original action to receive focus when the dialog closes. */
  returnFocus?: HTMLElement | null;
  /** Resolves focus after a transition, returning null when another dialog takes over. */
  getReturnFocus?: () => HTMLElement | null;
};

/** Renders the shared dialog layout used throughout the plan workflow. */
export const PlanDialog = ({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
  footer,
  fullScreen = false,
  busy = false,
  returnFocus,
  getReturnFocus,
}: PlanDialogProps) => (
  <Dialog.Root
    open={open}
    onOpenChange={(next) => {
      if (!busy) onOpenChange(next);
    }}
  >
    <Dialog.Portal>
      <Dialog.Overlay className={styles.overlay} />
      <div className={styles.viewport}>
        <Dialog.Content
          className={styles.content({ fullScreen })}
          onCloseAutoFocus={(event) => {
            if (getReturnFocus || returnFocus) {
              event.preventDefault();
              const target = getReturnFocus ? getReturnFocus() : returnFocus;
              if (target?.isConnected) target.focus();
            }
          }}
        >
          <header className={styles.header}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                className={controls.button({ variant: "ghost", square: true })}
                type="button"
                aria-label={closeLabel}
                disabled={busy}
              >
                <X className={controls.icon} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>
          <Dialog.Description className={controls.hidden}>{description}</Dialog.Description>
          <div className={styles.body}>{children}</div>
          {footer ? <footer className={styles.footer}>{footer}</footer> : null}
        </Dialog.Content>
      </div>
    </Dialog.Portal>
  </Dialog.Root>
);

/** Destructive confirmation shared by plan deletion and draft dismissal. */
type PlanConfirmationProps = {
  /** Whether confirmation is visible. */
  open: boolean;
  /** Updates the confirmation visibility. */
  onOpenChange: (open: boolean) => void;
  /** Destructive action heading. */
  title: string;
  /** Consequences of accepting the action. */
  description: string;
  /** Label for proceeding. */
  confirmLabel: string;
  /** Label for returning to the previous screen. */
  cancelLabel: string;
  /** Runs the confirmed action. */
  onConfirm: () => void;
  /** Whether the action is in progress. */
  busy?: boolean;
  /** Error displayed while leaving the confirmation available for retry. */
  error?: string | null;
  /** Original action to receive focus after dismissal. */
  returnFocus?: HTMLElement | null;
  /** Resolves a surviving action after a deleted card has been removed. */
  getReturnFocus?: () => HTMLElement | null;
};

/** Keeps destructive confirmations open until persistence succeeds. */
export const PlanConfirmation = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  busy = false,
  error,
  returnFocus,
  getReturnFocus,
}: PlanConfirmationProps) => (
  <AlertDialog.Root
    open={open}
    onOpenChange={(next) => {
      if (!busy) onOpenChange(next);
    }}
  >
    <AlertDialog.Portal>
      <AlertDialog.Overlay className={styles.overlay} />
      <div className={styles.viewport}>
        <AlertDialog.Content
          className={styles.content()}
          onCloseAutoFocus={(event) => {
            if (getReturnFocus || returnFocus) {
              event.preventDefault();
              const target = getReturnFocus ? getReturnFocus() : returnFocus;
              if (target?.isConnected) target.focus();
            }
          }}
        >
          <header className={styles.header}>
            <AlertDialog.Title className={styles.title}>{title}</AlertDialog.Title>
          </header>
          <div className={styles.body}>
            <AlertDialog.Description className={controls.muted}>
              {description}
            </AlertDialog.Description>
            {error ? (
              <p className={controls.feedback} role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <footer className={styles.footer}>
            <AlertDialog.Cancel asChild>
              <button type="button" className={controls.button()} disabled={busy}>
                {cancelLabel}
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                className={controls.button({ variant: "danger" })}
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  onConfirm();
                }}
              >
                {confirmLabel}
              </button>
            </AlertDialog.Action>
          </footer>
        </AlertDialog.Content>
      </div>
    </AlertDialog.Portal>
  </AlertDialog.Root>
);
