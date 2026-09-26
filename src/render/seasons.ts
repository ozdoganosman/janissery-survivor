/**
 * How the year looks, month by month (0 = Kânunusani). Drawing only: the simulation's
 * months pass the same whatever colour the ground is.
 */

export type Leaves = 'bare' | 'blossom' | 'green' | 'gold';

export interface SeasonLook {
  /** Snow on the ground and the roofs, 0..1. */
  snow: number;
  /** Fresh green of spring over the steppe. */
  spring: number;
  /** The summer steppe drying to straw. */
  dry: number;
  /** Autumn ochre. */
  autumn: number;
  /** What the poplars and the fruit trees wear. */
  leaves: Leaves;
}

const look = (snow: number, spring: number, dry: number, autumn: number, leaves: Leaves): SeasonLook => ({
  snow,
  spring,
  dry,
  autumn,
  leaves,
});

export const SEASON_LOOK: readonly SeasonLook[] = [
  look(0.95, 0, 0, 0, 'bare'), // Kânunusani
  look(0.8, 0, 0, 0, 'bare'), // Şubat
  look(0.15, 0.15, 0, 0, 'blossom'), // Mart
  look(0, 0.35, 0, 0, 'blossom'), // Nisan
  look(0, 0.3, 0, 0, 'green'), // Mayıs
  look(0, 0.1, 0.1, 0, 'green'), // Haziran
  look(0, 0, 0.3, 0, 'green'), // Temmuz
  look(0, 0, 0.45, 0, 'green'), // Ağustos
  look(0, 0, 0.4, 0.1, 'green'), // Eylül
  look(0, 0, 0.2, 0.35, 'gold'), // Teşrinievvel
  look(0, 0, 0, 0.45, 'gold'), // Teşrinisani
  look(0.45, 0, 0, 0.15, 'bare'), // Kânunuevvel
];

export const SEASON_COLORS = {
  snow: '#f6f3ec',
  spring: '#b5d07a',
  dry: '#e6d193',
  autumn: '#d4b079',
  /** Crowns in bloom, in autumn, and bare twigs. */
  blossom: '#f3d8de',
  gold: '#dcb13c',
  rust: '#c9823a',
  bare: '#8c765f',
  /** Snow on a roof. */
  roofSnow: '#f4f2ee',
} as const;
