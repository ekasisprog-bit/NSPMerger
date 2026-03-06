package expo.modules.nspnativeops

import com.github.junrar.Archive
import com.github.junrar.rarfile.FileHeader
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

class RarExtractor {

    companion object {
        private const val BUFFER_SIZE = 4 * 1024 * 1024 // 4MB
    }

    interface ProgressListener {
        fun onProgress(bytesExtracted: Long, totalBytes: Long, currentEntry: String)
    }

    data class ExtractionResult(
        val extractedFiles: List<String>,
        val totalBytes: Long
    )

    fun extract(
        rarFile: File,
        destDir: File,
        listener: ProgressListener?
    ): ExtractionResult {
        if (!destDir.exists()) {
            destDir.mkdirs()
        }

        val extractedFiles = mutableListOf<String>()
        var bytesExtracted: Long = 0
        val totalBytes = rarFile.length()

        Archive(FileInputStream(rarFile)).use { archive ->
            var fileHeader: FileHeader? = archive.nextFileHeader()
            while (fileHeader != null) {
                val entryName = fileHeader.fileName.replace("\\", "/")

                // Zip-slip protection
                val destFile = File(destDir, entryName)
                val canonicalDest = destFile.canonicalPath
                val canonicalDir = destDir.canonicalPath
                if (!canonicalDest.startsWith("$canonicalDir${File.separator}") && canonicalDest != canonicalDir) {
                    throw SecurityException("RAR entry is outside of the target dir: $entryName")
                }

                if (fileHeader.isDirectory) {
                    destFile.mkdirs()
                } else {
                    destFile.parentFile?.mkdirs()

                    BufferedOutputStream(FileOutputStream(destFile), BUFFER_SIZE).use { bos ->
                        archive.extractFile(fileHeader, bos)
                    }

                    val fileSize = destFile.length()
                    bytesExtracted += fileSize
                    extractedFiles.add(destFile.absolutePath)

                    listener?.onProgress(bytesExtracted, totalBytes, entryName)
                }

                fileHeader = archive.nextFileHeader()
            }
        }

        return ExtractionResult(extractedFiles, bytesExtracted)
    }
}
