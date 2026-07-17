import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, Settings, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";

import { styles } from "./local-data-settings.styles";
import type { LocalDataRepository } from "@/db";
import { localDataRepository } from "@/db";
import type { Messages } from "@/i18n";

/** Message dictionary used by the settings feature. */
type LocalDataSettingsMessages = Messages["settings"];

/** Creates a filesystem-friendly export filename from an ISO timestamp. */
const createExportFileName = (exportedAt: string): string => {
  const safeTimestamp = exportedAt.replaceAll(":", "-").replaceAll(".", "-");

  return `lift-log-export-${safeTimestamp}.json`;
};

/** Downloads a JSON-serializable value using a temporary object URL. */
const downloadJsonFile = (fileName: string, data: unknown): void => {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

/** Reads and parses a user-selected JSON file into an untrusted value. */
const readJsonFile = async (file: File): Promise<unknown> => {
  return JSON.parse(await file.text());
};

/** Props for the local data settings dialog. */
export type LocalDataSettingsProps = {
  /** Localized copy used by the settings UI. */
  messages: LocalDataSettingsMessages;

  /** Repository used to manage device-local data. */
  repository?: LocalDataRepository;

  /** Called after local data has been reset successfully. */
  onDataReset?: () => Promise<void> | void;

  /** Called after local data has been imported successfully. */
  onDataImported?: () => Promise<void> | void;
};

/** Dialog for infrequent app settings and device-local data actions. */
export const LocalDataSettings = ({
  messages,
  repository = localDataRepository,
  onDataReset,
  onDataImported,
}: LocalDataSettingsProps) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isBusy = isExporting || isImporting || isResetting;

  /** Updates the controlled settings dialog state. */
  const updateSettingsDialog = (isOpen: boolean) => {
    setIsSettingsOpen(isOpen);

    if (!isOpen) {
      setFeedbackMessage(null);
      setIsResetOpen(false);
      setPendingImportFile(null);
    }
  };

  /** Updates the controlled destructive reset confirmation state. */
  const updateResetDialog = (isOpen: boolean) => {
    setIsResetOpen(isOpen);
    setFeedbackMessage(null);
  };

  /** Exports all device-local app data as a downloaded JSON file. */
  const exportLocalData = async () => {
    setIsExporting(true);
    setFeedbackMessage(null);

    try {
      const localDataExport = await repository.exportData();

      downloadJsonFile(createExportFileName(localDataExport.exportedAt), localDataExport);
    } catch {
      setFeedbackMessage(messages.exportError);
    } finally {
      setIsExporting(false);
    }
  };

  /** Opens the native file picker to choose an export file to import. */
  const openImportPicker = () => {
    setFeedbackMessage(null);
    fileInputRef.current?.click();
  };

  /** Captures the selected export file and opens the import confirmation. */
  const handleImportFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    // Reset the input so selecting the same file again re-triggers this handler.
    event.target.value = "";

    if (file) {
      setPendingImportFile(file);
    }
  };

  /** Replaces all device-local app data with the selected export file. */
  const importLocalData = async () => {
    if (!pendingImportFile) {
      return;
    }

    setIsImporting(true);
    setFeedbackMessage(null);

    try {
      await repository.importData(await readJsonFile(pendingImportFile));
      await onDataImported?.();
      setPendingImportFile(null);
      setIsSettingsOpen(false);
    } catch {
      setPendingImportFile(null);
      setFeedbackMessage(messages.importError);
    } finally {
      setIsImporting(false);
    }
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

              <div className={styles.sectionActions}>
                <button
                  className={styles.button({ variant: "secondary" })}
                  type="button"
                  disabled={isBusy}
                  onClick={() => void exportLocalData()}
                >
                  <Download className={styles.icon} aria-hidden="true" />
                  <span>{isExporting ? messages.exportingAction : messages.exportAction}</span>
                </button>

                <button
                  className={styles.button({ variant: "secondary" })}
                  type="button"
                  disabled={isBusy}
                  onClick={openImportPicker}
                >
                  <Upload className={styles.icon} aria-hidden="true" />
                  <span>{isImporting ? messages.importingAction : messages.importAction}</span>
                </button>

                <input
                  ref={fileInputRef}
                  className={styles.visuallyHidden}
                  type="file"
                  accept="application/json"
                  onChange={handleImportFileSelected}
                />

                <AlertDialog.Root
                  open={pendingImportFile !== null}
                  onOpenChange={(isOpen) => {
                    if (!isOpen) {
                      setPendingImportFile(null);
                    }
                  }}
                >
                  <AlertDialog.Portal>
                    <AlertDialog.Overlay className={styles.dialogOverlay} />
                    <div className={styles.dialogViewport}>
                      <AlertDialog.Content className={styles.confirmDialogContent}>
                        <AlertDialog.Title className={styles.confirmTitle}>
                          {messages.importConfirmTitle}
                        </AlertDialog.Title>
                        <AlertDialog.Description className={styles.confirmDescription}>
                          {messages.importConfirmDescription}
                        </AlertDialog.Description>
                        <div className={styles.confirmActions}>
                          <AlertDialog.Action asChild>
                            <button
                              className={styles.button({ variant: "danger" })}
                              type="button"
                              disabled={isImporting}
                              onClick={(event) => {
                                event.preventDefault();
                                void importLocalData();
                              }}
                            >
                              <Upload className={styles.icon} aria-hidden="true" />
                              <span>
                                {isImporting
                                  ? messages.importingAction
                                  : messages.importConfirmAction}
                              </span>
                            </button>
                          </AlertDialog.Action>
                          <AlertDialog.Cancel asChild>
                            <button
                              className={styles.button({ variant: "secondary" })}
                              type="button"
                              disabled={isImporting}
                            >
                              {messages.cancelAction}
                            </button>
                          </AlertDialog.Cancel>
                        </div>
                      </AlertDialog.Content>
                    </div>
                  </AlertDialog.Portal>
                </AlertDialog.Root>

                <AlertDialog.Root open={isResetOpen} onOpenChange={updateResetDialog}>
                  <AlertDialog.Trigger asChild>
                    <button
                      className={styles.button({ variant: "danger" })}
                      type="button"
                      disabled={isBusy}
                    >
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
                                {isResetting
                                  ? messages.resettingAction
                                  : messages.resetConfirmAction}
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
              </div>
            </section>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
