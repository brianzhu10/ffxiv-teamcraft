import { ListRow } from '../../model/list-row';
import { DataType, getItemSource, ItemSource } from '@ffxiv-teamcraft/types';
import { ListStep, MapListStep } from './map-list-step';
import { ListDisplay } from '../../../../core/layout/list-display';
import { LazyData } from '@ffxiv-teamcraft/data/model/lazy-data';
import { getTiers } from '../../../../core/tools/get-tiers';
import { NodeTypeIconPipe } from '../../../../pipes/pipes/node-type-icon.pipe';
import { NavigationObjective } from '../../../map/navigation-objective';
import structuredClone from '@ungap/structured-clone';
import { LayoutRowFilter } from '../../../../core/layout/layout-row-filter';
import { SettingsService } from '../../../settings/settings.service';
import { List } from '../../model/list';

export class StepByStepList {
  public alarms: ListRow[] = [];

  public steps: Record<number, MapListStep> = {};

  public mapsByItemId: Record<number, number[]> = {};

  public maps: number[] = [];

  public crafts: ListRow[] = [];

  public totalTodo = 0;

  public totalDone = 0;

  public progress = 0;

  constructor(private readonly list: List, private readonly display: ListDisplay, private readonly housingMap: number,
              private readonly lazyMapData: LazyData['maps'], private readonly settings: SettingsService) {
    this.buildMapIndex();
    this.crafts = getTiers(this.crafts).map(tier => {
      return tier.sort((a, b) => {
        const aCraft = getItemSource(a, DataType.CRAFTED_BY)[0];
        const bCraft = getItemSource(b, DataType.CRAFTED_BY)[0];
        if (aCraft.job === bCraft.job) {
          return aCraft.rlvl - bCraft.rlvl;
        }
        return aCraft.job - bCraft.job;
      });
    }).flat();
  }

  private getMatchingSources(item: ListRow, filter: LayoutRowFilter): ItemSource[]{
    return item.sources.filter(s => {
      return filter.matches({...item, sources: [s]}, this.list, this.settings);
    });
  }

  private buildMapIndex(): void {
    this.display.rows.forEach(panel => {
      panel.rows.forEach(row => {
        let hasCoords = false;
        let matchingSources = this.getMatchingSources(row, panel.layoutRow.filter)
          .sort((a, b) => panel.layoutRow.filter.matchingSources.indexOf(a.type) - panel.layoutRow.filter.matchingSources.indexOf(b.type));
        if (matchingSources.length === 0) {
          matchingSources = row.sources;
        }
        matchingSources.forEach(source => {
          const positions = this.getPositions(source).filter(p => !!p.mapId);
          if (!hasCoords && positions.length > 0) {
            hasCoords = true;
            positions.forEach(position => {
              if (this.shouldAddMap(position.mapId)) {
                const preparedSource: ItemSource = structuredClone(source);
                if (preparedSource.type === DataType.TRADE_SOURCES) {
                  // If it's a trade, we want to filter to make sure it's on this map, to avoid showing wrong currency and details.
                  preparedSource.data = preparedSource.data.filter(ts => {
                    return ts.npcs.some(npc => npc.mapId === position.mapId);
                  });
                }
                if (preparedSource.type === DataType.VENDORS) {
                  // If it's a trade, we want to filter to make sure it's on this map, to avoid showing wrong currency and details.
                  preparedSource.data = preparedSource.data.filter(npc => npc.mapId === position.mapId);
                }
                const sourcesToTransfer = row.sources.filter(s => [DataType.MASTERBOOKS, DataType.DEPRECATED].includes(s.type));
                const sources = [...sourcesToTransfer, preparedSource];
                this.addToMapIndex(position.mapId, row, sources, position);
              }
            });
          }
        });
        if (!hasCoords) {
          if (matchingSources.some(s => s.type === DataType.CRAFTED_BY)) {
            this.crafts.push(row);
          } else {
            this.addToMapIndex(-1, row, row.sources);
          }
        }
      });
    });
  }

  private getPositions(source: ItemSource): Array<Omit<ListStep, 'uniqId' | 'row' | 'sources'>> {
    switch (source.type) {
      case DataType.GATHERED_BY:
        return source.data.nodes
          .filter(node => !node.limited)
          .map(node => {
            return {
              mapId: node.map,
              icon: (node.limited ? NodeTypeIconPipe.timed_icons : NodeTypeIconPipe.icons)[Math.abs(node.type)],
              coords: {
                x: node.x,
                y: node.y
              }
            };
          });
      case DataType.ALARMS:
        return source.data.map(alarm => {
          return {
            mapId: alarm.mapId,
            coords: alarm.coords,
            icon: NodeTypeIconPipe.timed_icons[Math.abs(alarm.type)],
            type: 'Gathering'
          };
        });
      case DataType.TRADE_SOURCES:
        return source.data.map(ts => {
          return ts.npcs.map(npc => {
            return {
              mapId: npc.mapId,
              coords: npc.coords,
              icon: 'https://www.garlandtools.org/db/images/marker/Shop.png',
              type: 'Trade' as NavigationObjective['type']
            };
          });
        }).flat();
      case DataType.VENDORS:
        return source.data.map(vendor => {
          return {
            mapId: vendor.mapId,
            coords: vendor.coords,
            icon: 'https://xivapi.com/i/065000/065002.png',
            type: 'Vendor'
          };
        });
      case DataType.DROPS:
        return source.data.map(drop => {
          return {
            mapId: drop.mapid,
            coords: drop.position,
            icon: 'https://www.garlandtools.org/db/images/Mob.png',
            type: 'Hunting',
            monster: drop.id
          };
        });
      case DataType.FATES:
        return source.data.map(fate => {
          return {
            mapId: fate.mapId,
            coords: fate.coords,
            type: 'Hunting',
            fate: fate.id
          };
        });
    }
    return [];
  }

  private addToMapIndex(mapId: number, row: ListRow, sources: ItemSource[], position?: Omit<ListStep, 'uniqId' | 'row' | 'sources'>): void {
    let entry: MapListStep = this.steps[mapId];
    if (!entry) {
      this.steps[mapId] = {
        mapId,
        sources: [],
        complete: true,
        isHousingMap: this.isHousingMap(mapId),
        itemsCount: 0,
        progress: 0,
        totalTodo: 0,
        totalDone: 0
      };
      entry = this.steps[mapId];
    }
    if (!this.mapsByItemId[row.id]) {
      this.mapsByItemId[row.id] = [];
    }
    if (mapId > -1 && !this.maps.includes(mapId)) {
      this.maps.push(mapId);
    }
    this.mapsByItemId[row.id].push(mapId);
    sources.forEach(source => {
      if (!entry.sources.includes(source.type)) {
        entry.sources.push(source.type);
      }
      entry[source.type] = entry[source.type] || [];
      const uniqId = this.getUniqId(row);
      if (!entry[source.type].some(e => e.uniqId === uniqId))
        entry[source.type].push({
          uniqId,
          row,
          sources,
          ...(position || {})
        });
      entry.complete = entry.complete && row.done >= row.amount;
      entry.itemsCount++;
      entry.totalTodo += row.amount;
      entry.totalDone += row.done;
      this.totalTodo += row.amount;
      this.totalDone += row.done;
      entry.progress = Math.ceil(100 * entry.totalDone / entry.totalTodo);
      this.progress = Math.ceil(100 * this.totalDone / this.totalTodo);
    });
    if (sources.some(s => s.type === DataType.ALARMS)) {
      this.alarms.push(row);
    }
  }

  private getUniqId(row: ListRow): string {
    return `${row.finalItem ? 'f' : 'i'}:${row.id}`;
  }

  private isHousingMap(mapId: number): boolean {
    return this.lazyMapData[mapId]?.housing;
  }

  private shouldAddMap(mapId: number): boolean {
    const mapData = this.lazyMapData[mapId];
    if (mapData?.housing) {
      return mapId === this.housingMap;
    }
    return true;
  }
}
