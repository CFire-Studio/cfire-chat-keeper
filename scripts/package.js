const { execFileSync } = require("child_process")
const { copyFileSync, mkdirSync, readdirSync, statSync } = require("fs")
const path = require("path")

const rootDirectory = path.resolve(__dirname, "..")
const packageJson = require(path.join(rootDirectory, "package.json"))
const plasmoBinPath = path.join(rootDirectory, "node_modules", "plasmo", "bin", "index.mjs")
const buildDirectory = path.join(rootDirectory, "build")
const distDirectory = path.join(rootDirectory, "dist")
const outputFileName = `${packageJson.name}-v${packageJson.version}.zip`
const outputFilePath = path.join(distDirectory, outputFileName)

const getLatestBuildZip = () => {
  const zipFiles = readdirSync(buildDirectory)
    .filter((fileName) => fileName.endsWith(".zip"))
    .map((fileName) => {
      const filePath = path.join(buildDirectory, fileName)
      return {
        filePath,
        modifiedAt: statSync(filePath).mtimeMs
      }
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt)

  if (zipFiles.length === 0) {
    throw new Error(`打包已执行，但 ${buildDirectory} 中没有找到 zip 文件。请检查 Plasmo package 输出目录。`)
  }

  return zipFiles[0].filePath
}

execFileSync(process.execPath, [plasmoBinPath, "package"], {
  cwd: rootDirectory,
  stdio: "inherit"
})

mkdirSync(distDirectory, { recursive: true })
copyFileSync(getLatestBuildZip(), outputFilePath)
console.log(`Package saved to ${outputFilePath}`)
