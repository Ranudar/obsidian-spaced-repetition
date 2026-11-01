import moment from "moment";

import {
    formatDate,
    formatDateWithMoment,
    globalDateProvider,
    IDayBoundary,
} from "src/utils/dates";

describe("Format date", () => {
    test("Different input overloads", () => {
        expect(formatDate(new Date(2023, 0, 1))).toBe("2023-01-01");
        expect(formatDate(2023, 1, 1)).toBe("2023-01-01");
        expect(formatDate(1672531200000)).toBe("2023-01-01");
    });

    test("handles a leap year date", () => {
        expect(formatDate(2020, 2, 29)).toBe("2020-02-29");
    });
});

describe("Format date with moment", () => {
    test("Different input overloads", () => {
        expect(formatDateWithMoment(1672531200000, "YYYY-MM-DD")).toBe("2023-01-01");
    });
});

describe("LiveDateProvider", () => {
    test("now", () => {
        expect(globalDateProvider.now.year()).toBe(moment().year());
        expect(globalDateProvider.now.month()).toBe(moment().month());
        expect(globalDateProvider.now.week()).toBe(moment().week());
        expect(globalDateProvider.now.date()).toBe(moment().date());
    });

    afterEach(() => {
        globalDateProvider.setDayBoundary(null);
        jest.useRealTimers();
    });

    const todayAt = (localTime: string, dayBoundary: IDayBoundary | null): string => {
        jest.useFakeTimers({ now: new Date(`2024-03-15T${localTime}`) });
        globalDateProvider.setDayBoundary(dayBoundary);
        return globalDateProvider.today.format("YYYY-MM-DD HH:mm:ss");
    };

    test("today without a day boundary starts at midnight", () => {
        expect(globalDateProvider.getDayBoundary()).toBe(null);
        expect(todayAt("00:00:00", null)).toBe("2024-03-15 00:00:00");
        expect(todayAt("23:59:59", null)).toBe("2024-03-15 00:00:00");
    });

    test("today with a midnight day boundary", () => {
        const dayBoundary: IDayBoundary = { hour: 0, minute: 0, second: 0 };
        expect(todayAt("00:00:00", dayBoundary)).toBe("2024-03-15 00:00:00");
        expect(globalDateProvider.getDayBoundary()).toEqual(dayBoundary);
    });

    test("today with a 04:00:00 day boundary", () => {
        const dayBoundary: IDayBoundary = { hour: 4, minute: 0, second: 0 };
        expect(todayAt("03:59:59", dayBoundary)).toBe("2024-03-14 00:00:00");
        expect(todayAt("04:00:00", dayBoundary)).toBe("2024-03-15 00:00:00");
        expect(todayAt("04:00:01", dayBoundary)).toBe("2024-03-15 00:00:00");
    });

    test("today with a boundary that has only minutes or seconds set", () => {
        expect(todayAt("00:29:59", { hour: 0, minute: 30, second: 0 })).toBe("2024-03-14 00:00:00");
        expect(todayAt("00:30:00", { hour: 0, minute: 30, second: 0 })).toBe("2024-03-15 00:00:00");
        expect(todayAt("00:00:14", { hour: 0, minute: 0, second: 15 })).toBe("2024-03-14 00:00:00");
    });

    test("today with a 23:00:00 day boundary", () => {
        const dayBoundary: IDayBoundary = { hour: 23, minute: 0, second: 0 };
        expect(todayAt("22:59:59", dayBoundary)).toBe("2024-03-14 00:00:00");
        expect(todayAt("23:00:00", dayBoundary)).toBe("2024-03-15 00:00:00");
    });
});
