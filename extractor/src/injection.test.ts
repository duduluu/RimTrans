import { genPathResolve } from '@huiji/shared-utils';
import * as io from '@rimtrans/io';
import {
  pathsDefs,
  pathsDefInjected,
  pathsTypePackage,
  outputInjectionMapLoaded,
  outputInjectionMapParsed,
  outputInjectionMapMerged,
  outputMissing,
  outputFuzzy,
  outputDefInjected,
  outputDefInjectedFuzzy,
} from './utils.test';
import { parseXML } from './xml';
import * as definition from './definition';
import * as typePackage from './type-package';
import {
  PathNode,
  Injection,
  InjectionMap,
  pathMatch,
  serializePath,
  deSerializePath,
  parse,
  load,
  merge,
  checkDuplicated,
  save,
} from './injection';
import {
  ATTRIBUTE_MUST_TRANSLATE,
  ATTRIBUTE_TRANSLATION_CAN_CHANGE_COUNT,
} from './constants';

describe('injection', () => {
  let defMaps: definition.DefDocumentMap[];
  let classInfoMap: Record<string, typePackage.ClassInfo>;
  let injectionMapsLoaded: InjectionMap[];
  let injectionMapsParsed: InjectionMap[];

  beforeAll(async () => {
    [defMaps, classInfoMap] = await Promise.all([
      definition.load(pathsDefs).then(definition.resolveInheritance),
      typePackage.load(pathsTypePackage),
    ]);
    defMaps[0]['zmocks_1.xml'] = parseXML(
      `<Defs>
        <ZMockDef>
          <defName>Mock1</defName>
          <label>label</label>
          <description>description</description>
          <some>
            <li>mock text</li>
            <li>mock text</li>
          </some>
          <someList>
            <li>
              <li>
                <a>a0</a>
              </li>
              <li>
                <a>a1</a>
              </li>
            </li>
          </someList>
          <fuzzy>mock text</fuzzy>
          <missing>
            <key>x</key>
            <value>0</value>
          </missing>
        </ZMockDef>
      </Defs>`,
    );
    defMaps.push({
      'mock.xml': parseXML(
        `<Defs>          
          <UnknownDef>
            <defName>Unknown</defName>
            <label>Unknown</label>
          </UnknownDef>
        </Defs>`,
      ),
    });
    classInfoMap.ZMockDef = {
      isAbstract: false,
      baseClass: 'Def',
      name: 'ZMockDef',
      fields: [
        ...classInfoMap.Def.fields,
        {
          name: 'some',
          attributes: [ATTRIBUTE_MUST_TRANSLATE, ATTRIBUTE_TRANSLATION_CAN_CHANGE_COUNT],
          type: {
            category: 'LIST',
            name: 'List',
            of: {
              category: 'VALUE',
              name: 'String',
            },
          },
        },
        {
          name: 'someList',
          attributes: [],
          type: {
            category: 'LIST',
            name: 'List',
            of: {
              category: 'LIST',
              name: 'List',
              of: {
                category: 'CLASS',
                name: 'ZMockClass',
              },
            },
          },
        },
        {
          name: 'fuzzy',
          attributes: [],
          type: {
            category: 'VALUE',
            name: 'String',
          },
        },
        {
          name: 'missing',
          attributes: [],
          type: {
            category: 'CLASS',
            name: 'ZMockMissingClass',
          },
        },
      ],
      handles: [],
    };
    classInfoMap.ZMockClass = {
      name: 'ZMockClass',
      isAbstract: false,
      fields: [
        {
          attributes: [],
          name: 'a',
          type: {
            category: 'VALUE',
            name: 'String',
          },
        },
      ],
      handles: [],
    };

    [injectionMapsLoaded, injectionMapsParsed] = await Promise.all([
      load(pathsDefInjected),
      parse(defMaps, classInfoMap),
    ]);
  });

  test('path', () => {
    expect(pathMatch(['Mock', 'label'], ['Mock', 'label'])).toBe(true);
    expect(pathMatch(['Mock', 'label'], ['Mock', 'description'])).toBe(false);
    expect(
      pathMatch(
        ['Mock', 'comps', 'compUsable', 'label'],
        ['Mock', 'comps', 'compUsable'],
      ),
    ).toBe(false);
    expect(pathMatch(['Mock', 'comps', 0], ['Mock', 'comps', 1])).toBe(false);

    expect(
      pathMatch(
        ['Mock', 'some', [0, 'compUsable'], 'a', 'label'],
        ['Mock', 'some', [0, 'compUsable'], 'a', 'label'],
      ),
    ).toBe(true);
    expect(
      pathMatch(
        ['Mock', 'some', [0, 'compUsable'], 'a', 'label'],
        ['Mock', 'some', [1, 'compUsable'], 'a', 'label'],
      ),
    ).toBe(false);
    expect(
      pathMatch(
        ['Mock', 'some', [0, 'compUsable-0'], 'a', 'label'],
        ['Mock', 'some', [0, 'compUsable-1'], 'a', 'label'],
      ),
    ).toBe(false);

    expect(
      pathMatch(
        ['Mock', 'some', [0, 'compUsable'], 'a', 'label'],
        ['Mock', 'some', 0, 'a', 'label'],
      ),
    ).toBe(true);
    expect(
      pathMatch(
        ['Mock', 'some', [0, 'compUsable'], 'a', 'label'],
        ['Mock', 'some', 1, 'a', 'label'],
      ),
    ).toBe(false);

    expect(
      pathMatch(
        ['Mock', 'some', [0, 'compUsable'], 'a', 'label'],
        ['Mock', 'some', 'compUsable', 'a', 'label'],
      ),
    ).toBe(true);
    expect(
      pathMatch(
        ['Mock', 'some', [0, 'compUsable'], 'a', 'label'],
        ['Mock', 'some', 'compUsable-1', 'a', 'label'],
      ),
    ).toBe(false);

    expect(
      pathMatch(
        ['Mock', 'some', 0, 'a', 'label'],
        ['Mock', 'some', [0, 'compUsable'], 'a', 'label'],
      ),
    ).toBe(true);
    expect(
      pathMatch(
        ['Mock', 'some', 1, 'a', 'label'],
        ['Mock', 'some', [0, 'compUsable'], 'a', 'label'],
      ),
    ).toBe(false);

    expect(
      pathMatch(
        ['Mock', 'some', 'compUsable', 'a', 'label'],
        ['Mock', 'some', [0, 'compUsable'], 'a', 'label'],
      ),
    ).toBe(true);
    expect(
      pathMatch(
        ['Mock', 'some', 'compUsable-1', 'a', 'label'],
        ['Mock', 'some', [0, 'compUsable'], 'a', 'label'],
      ),
    ).toBe(false);

    expect(serializePath(['Mock', 'some', 'a', 'label'])).toBe('Mock.some.a.label');
    expect(serializePath(['Mock', 'some', 0, 'label'])).toBe('Mock.some.0.label');
    expect(serializePath(['Mock', 'some', [0, 'compUsable'], 'a', 'label'])).toBe(
      'Mock.some.compUsable.a.label',
    );

    expect(deSerializePath('Mock.some.0.label')).toEqual(['Mock', 'some', 0, 'label']);
    expect(deSerializePath('Mock.some.1.label')).toEqual(['Mock', 'some', 1, 'label']);
  });

  test('load', async () => {
    expect(
      injectionMapsLoaded[0].ZMockDef.zmocks_1.some(
        inj =>
          typeof inj === 'object' &&
          pathMatch(inj.path, ['Mock1', 'label']) &&
          inj.translation === 'mock label',
      ),
    ).toBe(true);

    await io.save(
      outputInjectionMapLoaded,
      JSON.stringify(injectionMapsLoaded, undefined, '  '),
    );
  });

  test('parse', async () => {
    expect(
      injectionMapsParsed[0].BiomeDef.Biomes_Temperate.some(
        inj =>
          typeof inj === 'object' &&
          pathMatch(inj.path, ['TemperateForest', 'label']) &&
          inj.origin === 'temperate forest' &&
          inj.translation === 'TODO',
      ),
    );

    await io.save(
      outputInjectionMapParsed,
      JSON.stringify(injectionMapsParsed, undefined, '  '),
    );
  });

  test('missing', async () => {
    const missing: string[] = [];
    const [mapOld] = injectionMapsLoaded;
    const [mapNew] = injectionMapsParsed;

    expect(mapNew.ZZMockDef).toBeFalsy();
    expect(mapOld.ZZMockDef).toBeTruthy();
    expect(mapOld.ZZMockDef.zmocks_1).toBeTruthy();

    Object.entries(mapOld).forEach(([defType, subMapOld]) => {
      const subMapNew = mapNew[defType] || {};
      Object.entries(subMapOld).forEach(([fileName, injectionListOld]) => {
        const injectionListNew = subMapNew[fileName] || [];
        injectionListOld.forEach(injOld => {
          if (typeof injOld === 'string') {
            expect(injectionListNew.includes(injOld));
          } else {
            const injNew = injectionListNew.find(
              inj => typeof inj !== 'string' && pathMatch(inj.path, injOld.path),
            );

            if ((typeof injNew === 'object' && injNew.fuzzy) || !injNew) {
              missing.push(`${defType}.${injOld.path.join('.')}`);
            }
          }
        });
      });
    });
    await io.save(outputMissing, missing.sort().join('\n'));
  });

  test('fuzzy', async () => {
    const [map] = injectionMapsParsed;
    const fuzzy: string[] = [];
    Object.entries(map).forEach(([defType, subMap]) =>
      Object.entries(subMap).forEach(([fileName, injections]) =>
        injections.forEach(injection => {
          if (typeof injection === 'object' && injection.fuzzy) {
            fuzzy.push(`${defType}.${injection.path.slice(1).join('.')}`);
          }
        }),
      ),
    );
    await io.save(outputFuzzy, [...new Set(fuzzy)].sort().join('\n'));
  });

  test('save', async () => {
    const [mapOld] = injectionMapsLoaded;
    const [mapNew] = injectionMapsParsed;

    const mapMerged = merge(mapNew, mapOld);
    checkDuplicated([mapMerged]);

    expect(mapMerged).not.toBe(mapOld);
    expect(mapMerged).not.toBe(mapNew);

    expect(mapNew.ZZMockDef).toBeFalsy();
    expect(mapOld.ZZMockDef).toBeTruthy();
    expect(mapOld.ZZMockDef.zmocks_1).toBeTruthy();

    await Promise.all([
      io.deleteFileOrDirectory(outputDefInjected),
      io.deleteFileOrDirectory(outputDefInjectedFuzzy),
    ]);
    await Promise.all([
      save(`${outputDefInjected}_0`, mapMerged, false, {
        useTabs: true,
        endOfLine: 'crlf',
      }),
      save(`${outputDefInjected}_1`, mapMerged, false, { endOfLine: 'cr' }),
      save(`${outputDefInjected}_2`, mapMerged, false, { tabWidth: 4 }),
    ]);
    await Promise.all([
      io.save(outputInjectionMapMerged, JSON.stringify(mapMerged, undefined, '  ')),
      save(outputDefInjected, mapMerged),
      save(outputDefInjectedFuzzy, mapMerged, true),
    ]);
  });
});
