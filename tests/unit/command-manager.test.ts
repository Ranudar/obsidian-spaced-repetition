import { CommandManager } from "src/command-manager";
import { SettingsManager } from "src/data/settings-manager";
import SRPlugin from "src/main";
import { UIManager } from "src/ui/ui-manager";

// The real UI manager pulls in Obsidian views the mock doesn't provide; the commands only need UIState
jest.mock("src/ui/ui-manager", () => ({ UIState: {} }));

describe("CommandManager custom hotkeys", () => {
    function setup() {
        const added: string[] = [];
        const removed: string[] = [];
        const plugin = {
            addCommand: (command: { id: string }) => added.push(command.id),
            removeCommand: (id: string) => removed.push(id),
        } as unknown as SRPlugin;
        const settingsManager = { settings: {} } as unknown as SettingsManager;
        const manager = new CommandManager(plugin, settingsManager, {} as UIManager);
        return { manager, added, removed };
    }

    test("reset and open in background have distinct ids", () => {
        const { manager, added } = setup();
        manager.addCustomHotkeys();

        expect(added).toContain("srs-card-review-reset");
        expect(added).toContain("srs-card-review-open-in-background");
        expect(new Set(added).size).toBe(added.length);
    });

    test("every added hotkey is removed again", () => {
        const { manager, added, removed } = setup();
        manager.addCustomHotkeys();
        manager.removeCustomHotkeys();

        expect([...removed].sort()).toEqual([...added].sort());
    });
});
