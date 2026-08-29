import { app } from 'electron';
import { FileService } from './FileService';
import { LogService } from './LogService';
import { ParserService } from './ParserService';
import { CodeGeneratorService } from './CodeGeneratorService';
import { ValidationService } from './ValidationService';
import ProjectService from './ProjectService';
import { PathValidationService } from './PathValidationService';
import { SettingsService } from './SettingsService';
import { FileWatcherService } from './FileWatcherService';
import { UpdaterService } from './UpdaterService';
import { WorldService } from './WorldService';

/**
 * The main process's composition root.
 *
 * `main.ts` used to construct these at module scope, which made the set
 * unreachable from anything else main-side. Construction lives here instead so
 * a second consumer takes the same singletons rather than opening a second
 * SettingsService over the same file.
 *
 * Construction is deferred to the first `getServiceRegistry()` call, never done
 * at import: `main.ts` redirects `app.getPath('userData')` for the E2E harness
 * before it takes the registry, and LogService/SettingsService resolve that
 * path eagerly in their constructors.
 */
export interface ServiceRegistry {
  fileService: FileService;
  parserService: ParserService;
  codeGeneratorService: CodeGeneratorService;
  validationService: ValidationService;
  projectService: ProjectService;
  settingsService: SettingsService;
  fileWatcherService: FileWatcherService;
  updaterService: UpdaterService;
  worldService: WorldService;
  logService: LogService;
  pathValidator: PathValidationService;
}

let registry: ServiceRegistry | null = null;

function createServiceRegistry(): ServiceRegistry {
  const parserService = new ParserService();
  const codeGeneratorService = new CodeGeneratorService();
  const settingsService = new SettingsService();

  return {
    fileService: new FileService(),
    parserService,
    codeGeneratorService,
    validationService: new ValidationService(parserService, codeGeneratorService),
    projectService: new ProjectService(),
    settingsService,
    fileWatcherService: new FileWatcherService(),
    updaterService: new UpdaterService(settingsService),
    // Constructed eagerly, but it does not spawn its worker — and therefore
    // does not load the native addon — until a world is actually opened (§6).
    worldService: new WorldService(),
    logService: new LogService(app.getPath('userData'), app.getVersion()),
    // The path validator starts empty — paths are added when the user opens
    // files/projects via the main-process dialogs.
    pathValidator: new PathValidationService([]),
  };
}

export function getServiceRegistry(): ServiceRegistry {
  if (!registry) {
    registry = createServiceRegistry();
  }
  return registry;
}
