export class Logger {
    private timers: { [label: string]: number } = {};

    constructor(private write: (message: string) => void) { }

    public log(...messages: any[]): void {
        try {
            let outParts: string[] = [];
            for (let cur of messages) {
                if (typeof cur === "object") {
                    outParts.push(JSON.stringify(cur, null, 2));
                } else {
                    outParts.push(cur);
                }
            }
            this.write(outParts.join(" "));
        } catch (err) {
            this.write("logging error occurred " + messages.join(" "));
        }
    }

    public error(message: string) {
        this.write("[ERROR] " + message);
    }

    public time(label: string): void {
        if (this.timers[label]) {
            throw "already have timer for " + label;
        }

        this.timers[label] = Date.now().valueOf();
    }

    public timeEnd(label: string) {
        if (!this.timers[label]) {
            throw "no timer for " + label;
        }

        const duration = Date.now().valueOf() - this.timers[label];
        delete this.timers[label];
        this.write(label + " " + duration + "ms");
    }
}
