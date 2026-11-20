#!/usr/bin/env node
/**
 * Command-line entry for dsh.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { getDshRuntimeVersion, loadLayeredEnv, StartupError } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parseDshArgs } from './args.ts'
import { reportStartupFailure } from './startup-diagnostics.ts'
import type { RunProfileOptions } from './profile-boot.ts'

/** Installation-owned dependencies supplied by a packaged CLI launcher. */
export type RunCliOptions = Pick<RunProfileOptions, 'packageManager'> & {
  /** Permit plugin commands for Desktop's existing profile; reserved for its installed carrier. */
  manageDesktopProfile?: boolean
}

/**
 * Run the public dsh command-line interface.
 * @param options - Package runtime and Desktop profile access supplied by the installation.
 * @returns a promise that settles when the selected command mode finishes.
 */
export async function runCli(options: RunCliOptions = {}): Promise<void> {
  const version = getDshRuntimeVersion()
  const { manageDesktopProfile, ...profileOptions } = options
  const invocation = parseDshArgs(process.argv.slice(2), version, manageDesktopProfile)

  // mode 区分命令用途；web、headless 等启动方式保存在 invocation.profile 中。
  switch (invocation.mode) {
    case 'profile': {
      // 仅启动应用时加载 profile 运行器，其他命令无需加载它的依赖。
      const { runProfile } = await import('./profile-boot.ts')
      try {
        await runProfile({
          environment: loadLayeredEnv('dsh'),
          profile: invocation.profile,
          fromDefaultProfile: invocation.fromDefaultProfile,
          patchFiles: invocation.patches,
          // 交给 profile 解析的参数，例如 Web 的 --port 或 headless 的任务文本。
          args: invocation.args,
          ...profileOptions,
        })
      } catch (error) {
        // 已知启动失败输出诊断并以非零码退出，其他错误交给上层处理。
        if (!(error instanceof StartupError)) throw error
        await reportStartupFailure(error, { home: resolveDshHome(), version, profile: invocation.profile })
        process.exit(1)
      }
      break
    }
    case 'plugin': {
      // 管理指定 profile 的插件依赖，并将命令的退出码返回给终端。
      const { runPlugin } = await import('./plugin.ts')   // 引入插件树
      process.exit(await runPlugin(invocation.profile, invocation.args, options.packageManager))
      break
    }
    case 'dump-config': {
      // 输出组合后的配置，供检查插件配置使用，不启动应用。
      const { runDumpConfig } = await import('./dump-config.ts')
      runDumpConfig(
        invocation.profile,
        invocation.defaultOnly,
        invocation.patches,
        invocation.fromDefaultProfile,
      )
      break
    }
    case 'dump-config-schema': {
      // 输出配置的 JSON Schema，供配置校验和编辑器提示使用。
      const { runDumpConfigSchema } = await import('./dump-config-schema.ts')
      await runDumpConfigSchema(invocation.profile, invocation.patches, invocation.fromDefaultProfile)
      break
    }
    default:
      // never 检查帮助编译器发现新增命令类型却遗漏处理分支的情况。
      invocation satisfies never
      throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
  }
}

// 直接执行此文件时启动 CLI；被其他模块导入时，由调用方调用 runCli。
if (import.meta.main) {
  await runCli()
}
