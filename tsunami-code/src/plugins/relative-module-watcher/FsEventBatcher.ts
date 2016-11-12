import { debounce } from "lodash";
import { FsEvent } from "./FsEvent";

export class FsEventBatcher {
    private events: FsEvent[] = [];

    constructor(
        private onDidReceiveEvents: (events: FsEvent[]) => void
    ) { }

    public add(event: FsEvent) {
        this.events.push(event);
        this.maybeEmit();
    }

    private maybeEmit = debounce(() => {
        this.onDidReceiveEvents(this.events);
        this.events = [];
    }, 100);
}
