import pth from 'path';
import fse from 'fs-extra';
import globby from 'globby';
import { EventEmitter } from 'events';

import {
  FOLDER_NAME_ASSEMBLIES,
  FOLDER_NAME_DEFS,
  FOLDER_NAME_PATCHES,
  FOLDER_NAME_LANGUAGES,
  DEFAULT_LANGUAGE,
  FOLDER_NAME_BACKSTORIES,
  FOLDER_NAME_DEF_INJECTED,
  FOLDER_NAME_KEYED,
  FOLDER_NAME_STRINGS,
} from './constants';

import {
  WorkflowMap,
  createWorkflowMap,
  ExtractorEventEmitter,
} from './extractor-event-emitter';
import { PrettierOptions } from './xml';
import { Mod, ModOutput } from './mod';
import { TypePackageExtractor, getCoreTypePackage } from './type-package';
import { DefinitionExtractor } from './definition';
import { InjectionExtractor } from './injection';
import { KeyedReplacementExtractor } from './keyed-replacement';
import { StringsFileExtractor } from './strings-file';

export interface ExtractModConfig {
  /**
   * Path to the mod.
   */
  path: string;

  /**
   * Extract languages or not
   */
  extract: boolean;

  /**
   * Output languages as a stand alone mod or not.
   */
  outputAsMod?: boolean;

  /**
   * Output path.
   */
  outputPath?: string;
}

export interface ExtractConfig {
  /**
   * Find possible translatable fields in fuzzy mode or not.
   */
  fuzzy?: boolean;

  /**
   * File format options
   */
  prettierOptions?: PrettierOptions;

  /**
   * Mods configs
   */
  modConfigs: ExtractModConfig[];

  /**
   * Languages to extract.
   */
  languages: string[];

  /**
   * Run in brand new mode or not, this will clean old language data.
   */
  brandNewMode?: boolean;

  /**
   * Debug mode will output language intermediate data (json format) before serialize to xml.
   */
  debugMode?: boolean;
}

const WF_LOAD = 'Load';
const WF_PROCESS = 'Process';
const WF_SAVE = 'Save';

const WF_TYPE = 'Type';
const WF_INHERITANCE = 'Inheritance';
const WF_EXTRACT = 'Extract';
const WF_MERGE = 'Merge';

export class Extractor {
  public readonly emitter: ExtractorEventEmitter;

  /* eslint-disable lines-between-class-members */
  private readonly typePackageExtractor: TypePackageExtractor;
  private readonly definitionExtractor: DefinitionExtractor;
  private readonly injectionExtractor: InjectionExtractor;
  private readonly keyedReplacementExtractor: KeyedReplacementExtractor;
  private readonly stringsFileExtractor: StringsFileExtractor;
  /* eslint-enable lines-between-class-members */

  public constructor(rawEventEmitter?: EventEmitter) {
    const emitter = new ExtractorEventEmitter(rawEventEmitter);
    this.emitter = emitter;
    this.typePackageExtractor = new TypePackageExtractor(emitter);
    this.definitionExtractor = new DefinitionExtractor(emitter);
    this.injectionExtractor = new InjectionExtractor(emitter);
    this.keyedReplacementExtractor = new KeyedReplacementExtractor(emitter);
    this.stringsFileExtractor = new StringsFileExtractor(emitter);
  }

  /**
   * Create a new workflow map for storing workflow status
   */
  private workflowMap(config: ExtractConfig): WorkflowMap {
    const { modConfigs, languages } = config;
    return createWorkflowMap([
      WF_LOAD,
      // Assemblies
      ...modConfigs.map(mod => [WF_LOAD, mod.path, FOLDER_NAME_ASSEMBLIES]),
      // Defs
      ...modConfigs.map(mod => [WF_LOAD, mod.path, FOLDER_NAME_DEFS]),
      // English Keyed
      ...modConfigs.map(mod => [
        WF_LOAD,
        mod.path,
        FOLDER_NAME_LANGUAGES,
        DEFAULT_LANGUAGE,
        FOLDER_NAME_KEYED,
      ]),
      // English Strings
      ...modConfigs.map(mod => [
        WF_LOAD,
        mod.path,
        FOLDER_NAME_LANGUAGES,
        DEFAULT_LANGUAGE,
        FOLDER_NAME_STRINGS,
      ]),
      // DefInjected
      ...languages
        .map(lang =>
          modConfigs.map(mod => [
            WF_LOAD,
            mod.path,
            FOLDER_NAME_LANGUAGES,
            lang,
            FOLDER_NAME_DEF_INJECTED,
          ]),
        )
        .flat(),
      // Keyed
      ...languages
        .map(lang =>
          modConfigs.map(mod => [
            WF_LOAD,
            mod.path,
            FOLDER_NAME_LANGUAGES,
            lang,
            FOLDER_NAME_KEYED,
          ]),
        )
        .flat(),
      // Strings
      ...languages
        .map(lang =>
          modConfigs.map(mod => [
            WF_LOAD,
            mod.path,
            FOLDER_NAME_LANGUAGES,
            lang,
            FOLDER_NAME_STRINGS,
          ]),
        )
        .flat(),

      WF_PROCESS,
      [WF_PROCESS, FOLDER_NAME_ASSEMBLIES, WF_TYPE],
      [WF_PROCESS, FOLDER_NAME_DEFS, WF_INHERITANCE],
      [WF_PROCESS, FOLDER_NAME_DEF_INJECTED, WF_EXTRACT],
      [WF_PROCESS, FOLDER_NAME_DEF_INJECTED, WF_MERGE],

      WF_SAVE,
      ...languages
        .map(lang =>
          modConfigs
            .filter(mod => mod.extract)
            .map(mod => [
              [WF_SAVE, mod.path, FOLDER_NAME_LANGUAGES, lang, FOLDER_NAME_DEF_INJECTED],
              [WF_SAVE, mod.path, FOLDER_NAME_LANGUAGES, lang, FOLDER_NAME_KEYED],
              [WF_SAVE, mod.path, FOLDER_NAME_LANGUAGES, lang, FOLDER_NAME_STRINGS],
            ]),
        )
        .flat(2),
    ]);
  }

  /**
   *
   * @param paths the array of paths to mod directories, `[Core, ...Mods]`.
   */
  public async extract(config: ExtractConfig): Promise<Mod[]> {
    this.emitter.emit('workflowMap', this.workflowMap(config));

    const {
      fuzzy,
      prettierOptions,
      modConfigs,
      languages,
      brandNewMode,
      debugMode,
    } = config;

    const mods = await Promise.all(modConfigs.map(({ path }) => Mod.load(path)));
    const outputs = mods.map(
      (mod, modIndex): ModOutput => {
        const cfg = modConfigs[modIndex];
        if (cfg.outputAsMod && cfg.outputPath) {
          return mod.output(cfg.outputPath);
        }
        return mod;
      },
    );

    if (brandNewMode) {
      const toDeleteDirs: string[] = [];
      languages.forEach(lang =>
        outputs.forEach(output =>
          toDeleteDirs.push(
            output.pathDefInjected(lang),
            output.pathKeyed(lang),
            output.pathStrings(lang),
          ),
        ),
      );
      await Promise.all(toDeleteDirs.map(async dir => fse.remove(dir)));
    } else {
      const toCopyDirs: [string, string][] = [];
      languages.forEach(lang =>
        modConfigs.forEach((cfg, modIndex) => {
          if (cfg.outputAsMod && cfg.outputPath) {
            const mod = mods[modIndex];
            const output = outputs[modIndex];
            toCopyDirs.push(
              [mod.pathDefInjected(lang), output.pathDefInjected(lang)],
              [mod.pathKeyed(lang), output.pathKeyed(lang)],
              [mod.pathStrings(lang), output.pathStrings(lang)],
            );
          }
        }),
      );

      await Promise.all(
        toCopyDirs.map(async ([src, dest]) => {
          const [srcExists, destExists] = await Promise.all([
            fse.pathExists(src),
            fse.pathExists(dest),
          ]);
          if (srcExists && !destExists) {
            await fse.copy(src, dest);
          }
        }),
      );
    }

    const [
      typePackages,
      definitionMaps,
      englishKeyedMaps,
      englishStringsMaps,
      languagesToOldInjectionMaps,
      languagesToOldKeyedMaps,
      languagesToOldStringsMaps,
    ] = await this.emitter.workflow(WF_LOAD, () =>
      Promise.all([
        // Assemblies
        Promise.all(
          mods.map((mod, modIndex) =>
            this.emitter.workflow([WF_LOAD, mod.path, FOLDER_NAME_ASSEMBLIES], () =>
              this.typePackageExtractor.load(mod.pathAssemblies),
            ),
          ),
        ),

        // Defs
        Promise.all(
          mods.map((mod, modIndex) =>
            this.emitter.workflow([WF_LOAD, mod.path, FOLDER_NAME_DEFS], () =>
              this.definitionExtractor.load(mod.pathDefs),
            ),
          ),
        ),

        // English Keyed
        Promise.all(
          mods.map((mod, modIndex) =>
            this.emitter.workflow(
              [
                WF_LOAD,
                mod.path,
                FOLDER_NAME_LANGUAGES,
                DEFAULT_LANGUAGE,
                FOLDER_NAME_KEYED,
              ],
              () => this.keyedReplacementExtractor.load(mod.pathKeyed(DEFAULT_LANGUAGE)),
            ),
          ),
        ),

        // English Strings
        Promise.all(
          mods.map(mod =>
            this.emitter.workflow(
              [
                WF_LOAD,
                mod.path,
                FOLDER_NAME_LANGUAGES,
                DEFAULT_LANGUAGE,
                FOLDER_NAME_STRINGS,
              ],
              () => this.stringsFileExtractor.load(mod.pathStrings(DEFAULT_LANGUAGE)),
            ),
          ),
        ),

        // DefInjected
        Promise.all(
          languages.map((lang, langIndex) =>
            Promise.all(
              outputs.map((output, modIndex) =>
                this.emitter.workflow(
                  [
                    WF_LOAD,
                    mods[modIndex].path,
                    FOLDER_NAME_LANGUAGES,
                    lang,
                    FOLDER_NAME_DEF_INJECTED,
                  ],
                  () => this.injectionExtractor.load(output.pathDefInjected(lang)),
                ),
              ),
            ),
          ),
        ),

        // Keyed
        Promise.all(
          languages.map((lang, langIndex) =>
            Promise.all(
              outputs.map((output, modIndex) =>
                this.emitter.workflow(
                  [
                    WF_LOAD,
                    mods[modIndex].path,
                    FOLDER_NAME_LANGUAGES,
                    lang,
                    FOLDER_NAME_KEYED,
                  ],
                  () => this.keyedReplacementExtractor.load(output.pathKeyed(lang)),
                ),
              ),
            ),
          ),
        ),

        // Strings
        Promise.all(
          languages.map((lang, langIndex) =>
            Promise.all(
              outputs.map((output, modIndex) =>
                this.emitter.workflow(
                  [
                    WF_LOAD,
                    mods[modIndex].path,
                    FOLDER_NAME_LANGUAGES,
                    lang,
                    FOLDER_NAME_STRINGS,
                  ],
                  () => this.stringsFileExtractor.load(output.pathStrings(lang)),
                ),
              ),
            ),
          ),
        ),
      ]),
    );

    // Workflow Process

    const languageToMergedLanguageData = await this.emitter.workflow(
      WF_PROCESS,
      async () => {
        // Process TypePackage
        const { classInfoMap } = await this.emitter.workflow(
          [WF_PROCESS, FOLDER_NAME_ASSEMBLIES, WF_TYPE],
          async () =>
            this.typePackageExtractor.merge([getCoreTypePackage(), ...typePackages]),
        );

        // process Defs
        await this.emitter.workflow(
          [WF_PROCESS, FOLDER_NAME_DEFS, WF_INHERITANCE],
          async () => {
            this.definitionExtractor.resolveInheritance(definitionMaps);
          },
        );

        // extract
        const newInjectionMaps = await this.emitter.workflow(
          [WF_PROCESS, FOLDER_NAME_DEF_INJECTED, WF_EXTRACT],
          async () => {
            return this.injectionExtractor.parse(definitionMaps, classInfoMap, fuzzy);
          },
        );

        // merge
        return this.emitter.workflow(
          [WF_PROCESS, FOLDER_NAME_DEF_INJECTED, WF_MERGE],
          async () =>
            languages.map((lang, langIndex) => {
              // DefInjected
              const oldInjectionMaps = languagesToOldInjectionMaps[langIndex];
              const mergedInjectionMaps = mods.map((mod, modIndex) =>
                this.injectionExtractor.merge(
                  newInjectionMaps[modIndex],
                  oldInjectionMaps[modIndex],
                ),
              );
              this.injectionExtractor.checkDuplicated(mergedInjectionMaps);

              // Keyed
              const oldKeyedMaps = languagesToOldKeyedMaps[langIndex];
              const mergedKeyedMaps = mods.map((mod, modIndex) =>
                this.keyedReplacementExtractor.merge(
                  englishKeyedMaps[modIndex],
                  oldKeyedMaps[modIndex],
                ),
              );
              this.keyedReplacementExtractor.checkDuplicated(mergedKeyedMaps);

              // Strings
              const oldStringsMaps = languagesToOldStringsMaps[langIndex];
              const mergedStringsMaps = mods.map((mod, modIndex) =>
                this.stringsFileExtractor.merge(
                  englishStringsMaps[modIndex],
                  oldStringsMaps[modIndex],
                ),
              );

              return { mergedInjectionMaps, mergedKeyedMaps, mergedStringsMaps };
            }),
        );
      },
    );

    // Workflow Save

    await this.emitter.workflow(WF_SAVE, () =>
      Promise.all(
        languageToMergedLanguageData.map(
          async (
            { mergedInjectionMaps, mergedKeyedMaps, mergedStringsMaps },
            langIndex,
          ) => {
            const lang = languages[langIndex];
            await Promise.all(
              modConfigs.map(async (cfg, modIndex) => {
                if (!cfg.extract) {
                  return;
                }

                const mod = mods[modIndex];
                const output = outputs[modIndex];

                if (debugMode) {
                  await fse.outputJSON(
                    pth.join(output.pathLanguage(lang), 'intermediate-data.json'),
                    {
                      DefInjected: mergedInjectionMaps[modIndex],
                      Keyed: mergedKeyedMaps[modIndex],
                      Strings: mergedStringsMaps[modIndex],
                    },
                    { spaces: 2 },
                  );
                }

                await Promise.all([
                  // DefInjected
                  this.emitter.workflow(
                    [
                      WF_SAVE,
                      mod.path,
                      FOLDER_NAME_LANGUAGES,
                      lang,
                      FOLDER_NAME_DEF_INJECTED,
                    ],
                    () =>
                      this.injectionExtractor.save(
                        output.pathDefInjected(lang),
                        mergedInjectionMaps[modIndex],
                        prettierOptions,
                      ),
                  ),

                  // Keyed
                  this.emitter.workflow(
                    [WF_SAVE, mod.path, FOLDER_NAME_LANGUAGES, lang, FOLDER_NAME_KEYED],
                    () =>
                      this.keyedReplacementExtractor.save(
                        output.pathKeyed(lang),
                        mergedKeyedMaps[modIndex],
                        prettierOptions,
                      ),
                  ),

                  // Strings
                  this.emitter.workflow(
                    [WF_SAVE, mod.path, FOLDER_NAME_LANGUAGES, lang, FOLDER_NAME_STRINGS],
                    () =>
                      this.stringsFileExtractor.save(
                        output.pathStrings(lang),
                        mergedStringsMaps[modIndex],
                        prettierOptions,
                      ),
                  ),
                ]);
              }),
            );
          },
        ),
      ),
    );

    return mods;
  }
}
