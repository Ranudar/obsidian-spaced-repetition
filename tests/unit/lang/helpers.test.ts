import { t } from "src/lang/helpers";
import en from "src/lang/locale/en";
import { LocaleManagerInstance } from "src/lang/locale-manager";

describe("t", () => {
    afterEach(() => {
        LocaleManagerInstance.getInstance().currentLocale = "en";
        jest.restoreAllMocks();
    });

    test("falls back to English for a locale without a translation", () => {
        jest.spyOn(console, "warn").mockImplementation(() => {});
        LocaleManagerInstance.getInstance().currentLocale = "el";

        expect(t("DECKS")).toEqual(en.DECKS);
    });
});
