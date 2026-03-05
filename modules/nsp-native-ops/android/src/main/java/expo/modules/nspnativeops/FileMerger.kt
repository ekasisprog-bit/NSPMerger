package expo.modules.nspnativeops

import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

class FileMerger {

    companion object {
        private const val BUFFER_SIZE = 4 * 1024 * 1024 // 4MB
    }

    interface ProgressListener {
        fun onProgress(bytesWritten: Long, totalBytes: Long, currentPart: String)
    }

    data class MergeResult(
        val outputPath: String,
        val totalBytes: Long
    )

    fun merge(
        inputPaths: List<String>,
        outputPath: String,
        listener: ProgressListener?
    ): MergeResult {
        val outputFile = File(outputPath)
        outputFile.parentFile?.mkdirs()

        val totalBytes = inputPaths.sumOf { File(it).length() }
        var bytesWritten: Long = 0
        val buffer = ByteArray(BUFFER_SIZE)

        FileOutputStream(outputFile).use { fos ->
            for (inputPath in inputPaths) {
                val inputFile = File(inputPath)
                val currentPartName = inputFile.name

                BufferedInputStream(FileInputStream(inputFile), BUFFER_SIZE).use { bis ->
                    var bytesRead: Int
                    while (bis.read(buffer).also { bytesRead = it } != -1) {
                        fos.write(buffer, 0, bytesRead)
                        bytesWritten += bytesRead
                        listener?.onProgress(bytesWritten, totalBytes, currentPartName)
                    }
                }
            }
        }

        return MergeResult(outputPath, bytesWritten)
    }
}
