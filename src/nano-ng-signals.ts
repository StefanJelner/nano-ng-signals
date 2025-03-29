// A simple registry for all the signals involved
const registry = {
    // An array of signal objects
    signals: {} as Record<
        string,
        {
            // The value of the signal
            value: unknown;
            // The equality function to use for comparison
            equal: (a: unknown, b: unknown) => boolean;
            // A stack of set events for the signal
            __onSetStack: Array<() => void>;
        }
    >,
    // A stack of get events for all signals
    __onGetStack: [] as Array<(uid: string) => void>,
    // Should get events be ignored? (necessary for the untracked function)
    __ignoreGet: false,
    // The default equality function to use for comparison
    equal: (a: unknown, b: unknown): boolean => Object.is(a, b),
    // Generates a simple unique id
    getUid: (): string => `${window.performance.now()}_${Math.random().toString(16).slice(2)}`,
    // Gets the value from a signal and triggers a get event
    getValue: (uid: string) => {
        if (uid in registry.signals && 'value' in registry.signals[uid]) {
            // Dispatch the get event for each function in the get stack
            if (registry.__ignoreGet === false) {
                registry.__onGetStack.forEach((func) => func(uid));
            }

            return registry.signals[uid].value;
        }

        return undefined;
    },
    // Sets the value of a signal and triggers a set event
    setValue: (uid: string, equal: (a: unknown, b: unknown) => boolean, value: unknown): void => {
        let equal2 = false;

        // If the signal does not exist, create it
        if (!(uid in registry.signals)) {
            registry.signals[uid] = {
                value,
                equal,
                __onSetStack: [],
            };
        } else {
            // Check for equality
            equal2 = registry.signals[uid].equal(registry.signals[uid].value, value);

            if (equal2 === false) {
                registry.signals[uid].value = value;
            }
        }

        if (equal2 === false) {
            // Dispatch the set event for each function in the set stack
            registry.signals[uid].__onSetStack.forEach((func) => func());
        }
    },
    // Removes a signal
    removeSignal: (uid: string): void => {
        if (uid in registry.signals) {
            delete registry.signals[uid];
        }
    },
    // Monitors all the signals in a given function.
    // NOTE! It is important that each signal which is involved in the monitoring has to run.
    // If a signal is inside a condition which is not met, while the function is called the first time,
    // then this signal is not monitored in the future.
    monitorSignals: (func: () => void): (() => void) => {
        // Get a list of all uids which are involved in the function
        const uids: Array<string> = [];

        // Monitor get events
        const offGet = registry.onGet((uid: string) => uids.push(uid));

        // Call the function
        func();

        // Stop monitoring the get events
        offGet();

        // Monitor the set event for each signal which has been used in the function
        const offSets: Array<() => void> = uids.map((uid: string) => registry.onSet(uid, () => func()));

        // Return a function which stops monitoring all the set events
        return () => offSets.forEach((offSet: () => void) => offSet());
    },
    // Registers a get event and returns a callback function for unregistering
    onGet: (func: (uid: string) => void): (() => void) => {
        registry.__onGetStack.push(func);

        return () =>
            // Remove the function from the event stack
            (registry.__onGetStack = registry.__onGetStack.filter((func2) => func !== func2));
    },
    // Registers a set event and returns a callback function for unregistering
    onSet: (uid: string, func: () => void): (() => void) => {
        if (uid in registry.signals) {
            registry.signals[uid].__onSetStack.push(func);

            return () =>
                // Remove the function from the event stack
                (registry.signals[uid].__onSetStack = registry.signals[uid].__onSetStack.filter(
                    (func2) => func !== func2,
                ));
        }

        return () => {};
    },
};

/**
 * Creates a writable signal
 *
 * @param value the initial value for the writable signal
 * @param equal a custom equality function
 * @returns a writable signal
 */
function signal<T = unknown>(
    value: T,
    equal: (a: T, b: T) => boolean = registry.equal,
): {
    (): T;
    set: (value: T) => void;
    update: (func: (current: T) => T) => void;
    destroy: () => void;
    asReadonly: () => () => T;
} {
    const uid = registry.getUid();

    registry.setValue(uid, equal as (a: unknown, b: unknown) => boolean, value);

    const tmp = () => registry.getValue(uid) as T;
    tmp.set = (value2: T) => registry.setValue(uid, equal as (a: unknown, b: unknown) => boolean, value2);
    tmp.update = (func: (current: T) => T) =>
        registry.setValue(uid, equal as (a: unknown, b: unknown) => boolean, func(registry.getValue(uid) as T));
    tmp.destroy = () => registry.removeSignal(uid);
    tmp.asReadonly = () => () => registry.getValue(uid) as T;

    return tmp;
}

/**
 * Creates a readonly computed signal
 *
 * @param func a function to call whenever one of the involved signals changes
 * @param equal a custom equality function
 * @returns a readonly computed signal
 */
function computed<T = unknown>(
    func: () => T,
    equal: (a: T, b: T) => boolean = registry.equal,
): {
    (): T;
    destroy: () => void;
} {
    const uid = registry.getUid();

    const stopMonitoring = registry.monitorSignals(() => {
        registry.setValue(uid, equal as (a: unknown, b: unknown) => boolean, func());
    });

    const tmp = () => registry.getValue(uid) as T;
    tmp.destroy = () => stopMonitoring();

    return tmp;
}

/**
 * Creates an effect
 *
 * @param func a function to call whenever one of the involved signals changes
 * @returns an effect
 */
function effect(func: (onCleanup?: () => void) => void): {
    destroy: () => void;
} {
    let onCleanup: (() => void) | undefined = undefined;

    const stopMonitoring = registry.monitorSignals(() => {
        func((onCleanup2?: () => void) => (onCleanup = onCleanup2));

        if (typeof onCleanup === 'function') {
            onCleanup();
        }
    });

    return {
        destroy: () => {
            stopMonitoring();

            if (typeof onCleanup === 'function') {
                onCleanup();
            }
        },
    };
}

/**
 * Wrapper function to prevent inner signals in a given function from being monitored
 *
 * @param func a function with inner signals which should not be monitored
 * @returns the return value of the function provided in the parameter
 */
function untracked<T = unknown>(func: () => T): T {
    registry.__ignoreGet = true;

    const tmp = func();

    registry.__ignoreGet = false;

    return tmp;
}

export { signal, computed, effect, untracked };
