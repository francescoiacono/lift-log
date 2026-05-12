import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { Settings, Trash2, X } from "lucide-react";
import { useState } from "react";

import { styles } from "./local-data-settings.styles";
import type { LocalDataRepository } from "@/db";
import { localDataRepository } from "@/db";
import type { Messages } from "@/i18n";

/** Message dictionary used by the settings feature. */
type LocalDataSettingsMessages = Messages["settings"];

/** Props for the local data settings dialog. */
export type LocalDataSettingsProps = {
  /** Localized copy used by the settings UI. */
  messages: LocalDataSettingsMessages;

  /** Repository used to manage device-local data. */
  repository?: LocalDataRepository;

  /** Called after local data has been reset successfully. */
  onDataReset?: () => Promise<void> | void;
};

/** Dialog for infrequent app settings and device-local data actions. */
export const LocalDataSettings = ({
  messages,
  repository = localDataRepository,
  onDataReset,
}: LocalDataSettingsProps) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  /** Updates the controlled settings dialog state. */
  const updateSettingsDialog = (isOpen: boolean) => {
    setIsSettingsOpen(isOpen);

    if (!isOpen) {
      setFeedbackMessage(null);
      setIsResetOpen(false);
    }
  };

  /** Updates the controlled destructive reset confirmation state. */
  const updateResetDialog = (isOpen: boolean) => {
    setIsResetOpen(isOpen);
    setFeedbackMessage(null);
  };

  /** Deletes all device-local app data after confirmation. */
  const resetLocalData = async () => {
    setIsResetting(true);
    setFeedbackMessage(null);

    try {
      await repository.reset();
      await onDataReset?.();
      setIsResetOpen(false);
      setIsSettingsOpen(false);
    } catch {
      setIsResetOpen(false);
      setFeedbackMessage(messages.resetError);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <Dialog.Root open={isSettingsOpen} onOpenChange={updateSettingsDialog}>
      <Dialog.Trigger asChild>
        <button className={styles.triggerButton} type="button" aria-label={messages.openLabel}>
          <Settings className={styles.icon} aria-hidden="true" />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <div className={styles.dialogViewport}>
          <Dialog.Content className={styles.dialogContent}>
            <div className={styles.dialogHeader}>
              <div className={styles.dialogHeading}>
                <Dialog.Title className={styles.dialogTitle}>{messages.title}</Dialog.Title>
                <Dialog.Description className={styles.dialogDescription}>
                  {messages.description}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className={styles.iconButton} type="button">
                  <X className={styles.icon} aria-hidden="true" />
                  <span className={styles.visuallyHidden}>{messages.closeAction}</span>
                </button>
              </Dialog.Close>
            </div>

            {feedbackMessage ? <p className={styles.feedback}>{feedbackMessage}</p> : null}

            <section className={styles.section}>
              <div className={styles.sectionText}>
                <h2 className={styles.sectionTitle}>{messages.dataTitle}</h2>
                <p className={styles.sectionDescription}>{messages.dataDescription}</p>
              </div>

              <AlertDialog.Root open={isResetOpen} onOpenChange={updateResetDialog}>
                <AlertDialog.Trigger asChild>
                  <button className={styles.button({ variant: "danger" })} type="button">
                    <Trash2 className={styles.icon} aria-hidden="true" />
                    <span>{messages.resetAction}</span>
                  </button>
                </AlertDialog.Trigger>

                <AlertDialog.Portal>
                  <AlertDialog.Overlay className={styles.dialogOverlay} />
                  <div className={styles.dialogViewport}>
                    <AlertDialog.Content className={styles.confirmDialogContent}>
                      <AlertDialog.Title className={styles.confirmTitle}>
                        {messages.resetConfirmTitle}
                      </AlertDialog.Title>
                      <AlertDialog.Description className={styles.confirmDescription}>
                        {messages.resetConfirmDescription}
                      </AlertDialog.Description>
                      <div className={styles.confirmActions}>
                        <AlertDialog.Action asChild>
                          <button
                            className={styles.button({ variant: "danger" })}
                            type="button"
                            disabled={isResetting}
                            onClick={(event) => {
                              event.preventDefault();
                              void resetLocalData();
                            }}
                          >
                            <Trash2 className={styles.icon} aria-hidden="true" />
                            <span>
                              {isResetting ? messages.resettingAction : messages.resetConfirmAction}
                            </span>
                          </button>
                        </AlertDialog.Action>
                        <AlertDialog.Cancel asChild>
                          <button
                            className={styles.button({ variant: "secondary" })}
                            type="button"
                            disabled={isResetting}
                          >
                            {messages.cancelAction}
                          </button>
                        </AlertDialog.Cancel>
                      </div>
                    </AlertDialog.Content>
                  </div>
                </AlertDialog.Portal>
              </AlertDialog.Root>
            </section>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
