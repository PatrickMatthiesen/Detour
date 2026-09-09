import { Check, PackageCheck, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PackingItem, TripSnapshot } from "../types";
import "./PackingView.css";

type Props = {
  snapshot: TripSnapshot;
  update: (fn: (s: TripSnapshot) => TripSnapshot) => void;
};

type PackingFilter = "all" | "unpacked";

type PackingEditorProps = {
  initial: PackingItem;
  isNew: boolean;
  categories: string[];
  bags: string[];
  onClose: () => void;
  onSave: (item: PackingItem) => void;
};

function cleanOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function PackingEditor({ initial, isNew, categories, bags, onClose, onSave }: PackingEditorProps) {
  const [draft, setDraft] = useState<PackingItem>(() => ({ ...initial }));
  const [quantityText, setQuantityText] = useState(() => String(initial.quantity));
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const categoryListId = `packing-category-options-${initial.id}`;
  const bagListId = `packing-bag-options-${initial.id}`;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    const focusFrame = requestAnimationFrame(() => nameInput.current?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, []);

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.name.trim();
    const category = draft.category.trim();
    const quantity = Number(quantityText);

    if (!name) {
      setError("Name is required.");
      nameInput.current?.focus();
      return;
    }
    if (!category) {
      setError("Category is required.");
      return;
    }
    if (!/^\d+$/.test(quantityText.trim()) || !Number.isSafeInteger(quantity) || quantity < 1) {
      setError("Quantity must be a positive whole number.");
      return;
    }

    onSave({
      ...draft,
      name,
      category,
      quantity,
      bag: cleanOptional(draft.bag || ""),
      notes: cleanOptional(draft.notes || ""),
    });
  };

  return (
    <dialog
      ref={dialog}
      className="packing-editor"
      aria-labelledby="packing-editor-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="packing-editor-form" onSubmit={save} noValidate>
        <header className="packing-editor-header">
          <h2 id="packing-editor-heading">{isNew ? "Add packing item" : "Edit packing item"}</h2>
          <button type="button" className="packing-icon-button" onClick={onClose} aria-label="Close packing editor">
            <X size={19} />
          </button>
        </header>

        {error && <p className="packing-editor-error" role="alert">{error}</p>}

        <div className="packing-editor-fields">
          <label>
            Name
            <input
              ref={nameInput}
              required
              value={draft.name}
              onChange={(event) => { setDraft((current) => ({ ...current, name: event.target.value })); setError(""); }}
              aria-invalid={error === "Name is required."}
            />
          </label>
          <div className="packing-editor-grid">
            <label>
              Category
              <input
                required
                list={categoryListId}
                value={draft.category}
                onChange={(event) => { setDraft((current) => ({ ...current, category: event.target.value })); setError(""); }}
                aria-invalid={error === "Category is required."}
              />
              <datalist id={categoryListId}>{categories.map((category) => <option value={category} key={category} />)}</datalist>
            </label>
            <label>
              Quantity
              <input
                required
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={quantityText}
                onChange={(event) => { setQuantityText(event.target.value); setError(""); }}
                aria-invalid={error === "Quantity must be a positive whole number."}
              />
            </label>
          </div>
          <label>
            Bag <span className="packing-optional">(optional)</span>
            <input
              list={bagListId}
              value={draft.bag || ""}
              onChange={(event) => setDraft((current) => ({ ...current, bag: event.target.value }))}
            />
            <datalist id={bagListId}>{bags.map((bag) => <option value={bag} key={bag} />)}</datalist>
          </label>
          <label>
            Notes <span className="packing-optional">(optional)</span>
            <textarea rows={3} value={draft.notes || ""} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
          </label>
        </div>

        <footer className="packing-editor-footer">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="packing-primary">{isNew ? "Add item" : "Save item"}</button>
        </footer>
      </form>
    </dialog>
  );
}

function newPackingItem(): PackingItem {
  return { id: crypto.randomUUID(), name: "", category: "", quantity: 1, packed: false, bag: null, notes: null };
}

export default function PackingView({ snapshot, update }: Props) {
  const [filter, setFilter] = useState<PackingFilter>("all");
  const [selectedBag, setSelectedBag] = useState("");
  const [editor, setEditor] = useState<{ item: PackingItem; isNew: boolean } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const items = snapshot.packingItems;
  const packedCount = items.filter((item) => item.packed).length;
  const bags = useMemo(
    () => [...new Set(items.map((item) => item.bag?.trim()).filter((bag): bag is string => !!bag))].sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [items],
  );

  useEffect(() => {
    if (selectedBag && !bags.includes(selectedBag)) setSelectedBag("");
  }, [bags, selectedBag]);

  const visibleItems = useMemo(
    () => items.filter((item) => (filter === "all" || !item.packed) && (!selectedBag || item.bag?.trim() === selectedBag)),
    [filter, items, selectedBag],
  );
  const groups = useMemo(() => {
    const grouped = new Map<string, PackingItem[]>();
    for (const item of visibleItems) {
      const category = item.category.trim() || "Uncategorized";
      const group = grouped.get(category) || [];
      group.push(item);
      grouped.set(category, group);
    }
    return [...grouped.entries()];
  }, [visibleItems]);

  const openAdd = () => {
    setDeletingId(null);
    setEditor({ item: newPackingItem(), isNew: true });
  };

  const togglePacked = (id: string) => {
    update((current) => ({
      ...current,
      packingItems: current.packingItems.map((item) => item.id === id ? { ...item, packed: !item.packed } : item),
    }));
  };

  const saveItem = (item: PackingItem, isNew: boolean) => {
    update((current) => ({
      ...current,
      packingItems: isNew
        ? [...current.packingItems, item]
        : current.packingItems.map((currentItem) => currentItem.id === item.id ? item : currentItem),
    }));
    setEditor(null);
  };

  const removeItem = (id: string) => {
    update((current) => ({
      ...current,
      packingItems: current.packingItems.filter((item) => item.id !== id),
    }));
    setDeletingId(null);
  };

  return (
    <section className="packing-view" aria-label="Packing list">
      <div className="packing-toolbar">
        <div className="packing-count" aria-live="polite">
          <PackageCheck size={18} aria-hidden="true" />
          <strong>{packedCount} / {items.length}</strong>
          <span>packed</span>
        </div>
        <button type="button" className="packing-add-button" onClick={openAdd}><Plus size={16} /> Add item</button>
      </div>

      <div className="packing-filters" role="toolbar" aria-label="Packing filters">
        <div className="packing-filter-tabs" role="group" aria-label="Packing status">
          <button type="button" className={filter === "all" ? "is-active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All <span>{items.length}</span></button>
          <button type="button" className={filter === "unpacked" ? "is-active" : ""} aria-pressed={filter === "unpacked"} onClick={() => setFilter("unpacked")}>Unpacked <span>{items.length - packedCount}</span></button>
        </div>
        {bags.length > 0 && (
          <label className="packing-bag-filter">
            <span>Bag</span>
            <select value={selectedBag} onChange={(event) => setSelectedBag(event.target.value)} aria-label="Filter by bag">
              <option value="">Every bag</option>
              {bags.map((bag) => <option value={bag} key={bag}>{bag}</option>)}
            </select>
          </label>
        )}
      </div>

      {groups.length > 0 ? (
        <div className="packing-groups">
          {groups.map(([category, categoryItems]) => (
            <section className="packing-group" key={category} aria-labelledby={`packing-group-${category}`}>
              <div className="packing-group-heading">
                <h2 id={`packing-group-${category}`}>{category}</h2>
                <span>{categoryItems.length}</span>
              </div>
              <ul className="packing-list">
                {categoryItems.map((item) => (
                  <li className={`packing-row${item.packed ? " is-packed" : ""}`} key={item.id}>
                    <button
                      type="button"
                      className="packing-check"
                      aria-label={`Mark ${item.name} ${item.packed ? "unpacked" : "packed"}`}
                      aria-pressed={item.packed}
                      onClick={() => togglePacked(item.id)}
                    >
                      {item.packed && <Check size={15} strokeWidth={3} aria-hidden="true" />}
                    </button>
                    <div className="packing-item-copy">
                      <strong>{item.name}</strong>
                      <span>
                        {item.quantity > 1 ? `${item.quantity} × ` : ""}
                        {item.bag?.trim() || "No bag assigned"}
                        {item.notes?.trim() ? ` · ${item.notes.trim()}` : ""}
                      </span>
                    </div>
                    <div className="packing-row-actions">
                      <button type="button" className="packing-row-button" onClick={() => { setDeletingId(null); setEditor({ item, isNew: false }); }} aria-label={`Edit ${item.name}`} title="Edit item"><Pencil size={15} /></button>
                      {deletingId === item.id ? (
                        <span className="packing-confirm" role="group" aria-label={`Confirm deleting ${item.name}`}>
                          <span>Delete?</span>
                          <button type="button" className="packing-confirm-delete" onClick={() => removeItem(item.id)}>Delete</button>
                          <button type="button" className="packing-confirm-cancel" onClick={() => setDeletingId(null)}>Cancel</button>
                        </span>
                      ) : (
                        <button type="button" className="packing-row-button packing-delete" onClick={() => setDeletingId(item.id)} aria-label={`Delete ${item.name}`} title="Delete item"><Trash2 size={15} /></button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="packing-empty">
          <PackageCheck size={25} aria-hidden="true" />
          <strong>{items.length ? "Nothing matches this filter" : "Your packing list is empty"}</strong>
          <span>{items.length ? "Try another filter or bag." : "Add the first thing you want to take."}</span>
          <button type="button" className="packing-empty-action" onClick={openAdd}><Plus size={15} /> Add item</button>
        </div>
      )}

      {editor && <PackingEditor key={editor.item.id} initial={editor.item} isNew={editor.isNew} categories={categories} bags={bags} onClose={() => setEditor(null)} onSave={(item) => saveItem(item, editor.isNew)} />}
    </section>
  );
}
