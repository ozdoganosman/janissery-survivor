/**
 * Interface text, in one table.
 *
 * The skeleton rather than the translation project: every string the shell shows is
 * looked up by id, so adding a language is an extra column here and nothing else. It
 * matters now because strings scattered through a dozen modules are the part of
 * localisation that is expensive to undo — the translating itself never is.
 *
 * What is *not* here: the names of weapons, items and creatures. Those live in
 * `data/balance/*.json` beside their numbers, because they are content rather than
 * chrome — renaming Yatağan is a balance-table edit, not a translation.
 */

export const LANGUAGE_IDS = ['tr', 'en'] as const;
export type LanguageId = (typeof LANGUAGE_IDS)[number];

export const LANGUAGE_NAMES: Readonly<Record<LanguageId, string>> = {
  tr: 'Turkce',
  en: 'English',
};

type Entry = Readonly<Record<LanguageId, string>>;

const TABLE = {
  'game.title': { tr: 'Yeniçeri Sağkalım', en: 'Janissary Survivor' },
  'game.tagline': {
    tr: 'On beş dakika dayan.',
    en: 'Survive fifteen minutes.',
  },

  'menu.start': { tr: 'Başla', en: 'Start' },
  'menu.settings': { tr: 'Ayarlar', en: 'Settings' },
  'menu.help': { tr: 'Nasıl oynanır', en: 'How to play' },
  'menu.back': { tr: 'Geri', en: 'Back' },
  'menu.resume': { tr: 'Devam et', en: 'Resume' },
  'menu.quit': { tr: 'Ana menü', en: 'Main menu' },
  'menu.restart': { tr: 'Yeniden başla', en: 'Play again' },

  'pause.title': { tr: 'Duraklatıldı', en: 'Paused' },

  'help.title': { tr: 'Nasıl oynanır', en: 'How to play' },
  'help.move': { tr: 'Hareket', en: 'Move' },
  'help.moveKeys': { tr: 'WASD / ok tuşları / kol çubuğu', en: 'WASD / arrows / stick' },
  'help.moveTouch': { tr: 'Dokunmatikte parmağını sürükle', en: 'Drag anywhere to steer' },
  'help.pause': { tr: 'Duraklat', en: 'Pause' },
  'help.pauseKeys': { tr: 'Esc veya P', en: 'Esc or P' },
  'help.attack': { tr: 'Saldırı', en: 'Attacks' },
  'help.attackBody': {
    tr: 'Silahların kendiliğinden ateşler. Senin işin nereye durmayacağına karar vermek.',
    en: 'Your weapons fire themselves. Your job is deciding where not to stand.',
  },
  'help.gems': { tr: 'Mücevherler', en: 'Gems' },
  'help.gemsBody': {
    tr: 'Düşenler mücevher bırakır; topladıkça seviye atlar ve üç karttan birini seçersin.',
    en: 'The fallen drop gems. Collect them to level up and pick one of three cards.',
  },
  'help.goal': { tr: 'Amaç', en: 'Goal' },
  'help.goalBody': {
    tr: 'On beş dakika hayatta kal. Onuncu ve on dördüncü dakikada Gulyabani Ağası gelir.',
    en: 'Stay alive for fifteen minutes. The Gulyabani Agha arrives at ten and fourteen.',
  },

  'settings.title': { tr: 'Ayarlar', en: 'Settings' },
  'settings.language': { tr: 'Dil', en: 'Language' },
  'settings.shake': { tr: 'Ekran sarsıntısı', en: 'Screen shake' },
  'settings.damageNumbers': { tr: 'Hasar sayıları', en: 'Damage numbers' },
  'settings.quality': { tr: 'Kalite', en: 'Quality' },
  'settings.qualityNote': {
    tr: 'Düşük kalite sahadaki düşman sayısını kısar.',
    en: 'Lower quality caps how many enemies are on the field.',
  },
  'settings.music': { tr: 'Müzik', en: 'Music' },
  'settings.sfx': { tr: 'Ses efektleri', en: 'Sound effects' },
  'volume.off': { tr: 'Kapalı', en: 'Off' },
  'volume.low': { tr: 'Kısık', en: 'Low' },
  'volume.medium': { tr: 'Orta', en: 'Medium' },
  'volume.high': { tr: 'Yüksek', en: 'High' },
  'summary.best': { tr: 'En iyi', en: 'Best' },
  'summary.newBest': { tr: 'Yeni rekor', en: 'New best' },
  'settings.bindings': { tr: 'Tuşlar', en: 'Keys' },
  'settings.bindingHint': {
    tr: 'Değiştirmek için tuşa bas, vazgeçmek için Esc.',
    en: 'Press a key to bind it, Esc to cancel.',
  },
  'settings.listening': { tr: 'bir tuşa bas', en: 'press a key' },
  'settings.reset': { tr: 'Varsayılana dön', en: 'Reset to defaults' },

  'action.up': { tr: 'Yukarı', en: 'Up' },
  'action.down': { tr: 'Aşağı', en: 'Down' },
  'action.left': { tr: 'Sol', en: 'Left' },
  'action.right': { tr: 'Sağ', en: 'Right' },
  'action.pause': { tr: 'Duraklat', en: 'Pause' },

  'quality.low': { tr: 'Düşük', en: 'Low' },
  'quality.medium': { tr: 'Orta', en: 'Medium' },
  'quality.high': { tr: 'Yüksek', en: 'High' },

  'toggle.on': { tr: 'Açık', en: 'On' },
  'toggle.off': { tr: 'Kapalı', en: 'Off' },

  'summary.survived': { tr: 'Hayatta kaldın', en: 'You survived' },
  'summary.fell': { tr: 'Düştün', en: 'You fell' },
  'summary.time': { tr: 'Süre', en: 'Time' },
  'summary.level': { tr: 'Seviye', en: 'Level' },
  'summary.kills': { tr: 'Öldürme', en: 'Kills' },
  'summary.weapons': { tr: 'Silahlar', en: 'Weapons' },
  'summary.items': { tr: 'Eşyalar', en: 'Items' },

  'levelup.title': { tr: 'Seviye', en: 'Level' },
  'levelup.pick': { tr: 'birini seç', en: 'pick one' },
  'levelup.key': { tr: '{n} tuşu', en: 'key {n}' },
  'card.weapon': { tr: 'Silah', en: 'Weapon' },
  'card.item': { tr: 'Eşya', en: 'Item' },
  'card.treat': { tr: 'İkram', en: 'Treat' },
  'hud.build': { tr: 'Kuşam', en: 'Loadout' },
} as const satisfies Record<string, Entry>;

export type StringId = keyof typeof TABLE;

let current: LanguageId = 'tr';

export function setLanguage(language: LanguageId): void {
  current = language;
}

export function getLanguage(): LanguageId {
  return current;
}

/**
 * Looks up a string in the current language.
 *
 * Falls back to Turkish rather than to the id: a missing translation should show the
 * sentence someone can still read, not `menu.start`.
 */
export function t(id: StringId): string {
  const entry: Entry = TABLE[id];
  return entry[current] || entry.tr;
}

/** Every id in the table. For the test that keeps the columns in step. */
export const STRING_IDS = Object.keys(TABLE) as StringId[];

/** Raw access, for the completeness test. Not for rendering — use `t`. */
export function entryOf(id: StringId): Entry {
  return TABLE[id];
}
