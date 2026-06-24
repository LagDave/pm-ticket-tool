/**
 * Shared toast helpers (§16.3). Surface errors here, not ad-hoc alert()/console.
 * Thin wrapper over react-hot-toast so the rest of the app has one import.
 */
import hotToast from "react-hot-toast";

export const toast = {
  success: (message: string): void => {
    hotToast.success(message);
  },
  error: (message: string): void => {
    hotToast.error(message);
  },
};
