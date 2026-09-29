import { createContext, useContext, type ComponentProps } from "react";

type EditingState = { canEdit: boolean; reason: string; recovering?: boolean; reload?: () => void };
export const TripEditingContext = createContext<EditingState>({ canEdit: true, reason: "" });
export const useTripEditing = () => useContext(TripEditingContext);

export function MutationButton({ disabled, title, ...props }: ComponentProps<"button">) {
  const editing = useTripEditing();
  return <button {...props} disabled={disabled || !editing.canEdit}
    title={!editing.canEdit ? editing.reason : title} />;
}

export function MutationInput({ disabled, title, ...props }: ComponentProps<"input">) {
  const editing = useTripEditing();
  return <input {...props} disabled={disabled || !editing.canEdit}
    title={!editing.canEdit ? editing.reason : title} />;
}

// Dialogs are in the top layer, so the page's recovery banner may be obscured.
export function EditingNotice() {
  const editing = useTripEditing();
  return editing.canEdit ? null : <div className="editing-notice" role="status"><p>{editing.reason} Your draft has not been saved.</p>{editing.reload && <button type="button" disabled={editing.recovering} onClick={editing.reload}>{editing.recovering ? "Reloading…" : "Reload saved trip"}</button>}</div>;
}
