import type { TripSnapshot } from "./types";

export type TripUpdater = (current: TripSnapshot) => TripSnapshot;

type StoreListener = (snapshot: TripSnapshot, error: string) => void;

export class TripMutationQueue {
  private confirmed: TripSnapshot;
  private visible: TripSnapshot;
  private readonly pending: TripUpdater[] = [];
  private saving = false;
  private blocked = false;

  constructor(
    initial: TripSnapshot,
    private readonly save: (snapshot: TripSnapshot) => Promise<TripSnapshot>,
    private readonly notify: StoreListener,
  ) {
    this.confirmed = structuredClone(initial);
    this.visible = structuredClone(initial);
  }

  replaceConfirmed(snapshot: TripSnapshot) {
    if (this.saving || this.pending.length > 0 || this.blocked) return;
    this.confirmed = structuredClone(snapshot);
    this.visible = structuredClone(snapshot);
    this.notify(this.visible, "");
  }

  reset(snapshot: TripSnapshot) {
    this.pending.length = 0;
    this.saving = false;
    this.blocked = false;
    this.confirmed = structuredClone(snapshot);
    this.visible = structuredClone(snapshot);
    this.notify(this.visible, "");
  }

  enqueue(updater: TripUpdater) {
    if (this.blocked) return false;
    this.pending.push(updater);
    this.visible = updater(structuredClone(this.visible));
    this.notify(this.visible, "");
    void this.drain();
    return true;
  }

  private async drain(): Promise<void> {
    if (this.saving || this.blocked || this.pending.length === 0) return;
    this.saving = true;
    const updater = this.pending[0];
    const next = updater(structuredClone(this.confirmed));

    try {
      const saved = await this.save(next);
      this.confirmed = structuredClone(saved);
      this.pending.shift();
      this.visible = this.pending.reduce(
        (current, pendingUpdater) => pendingUpdater(structuredClone(current)),
        structuredClone(this.confirmed),
      );
      this.notify(this.visible, "");
      this.saving = false;
      void this.drain();
    } catch (error) {
      this.pending.length = 0;
      this.saving = false;
      this.blocked = true;
      this.visible = structuredClone(this.confirmed);
      this.notify(
        this.visible,
        error instanceof Error ? error.message : "The trip could not be saved.",
      );
    }
  }
}
