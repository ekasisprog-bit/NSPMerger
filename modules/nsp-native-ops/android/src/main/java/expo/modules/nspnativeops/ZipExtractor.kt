package expo.modules.nspnativeops

import android.content.Context
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.zip.ZipInputStream

class ZipExtractor(private val context: Context) {

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
        inputStream: InputStream,
        destDir: File,
        totalZipSize: Long,
        listener: ProgressListener?
    ): ExtractionResult {
        if (!destDir.exists()) {
            destDir.mkdirs()
        }

        val extractedFiles = mutableListOf<String>()
        var bytesExtracted: Long = 0
        val buffer = ByteArray(BUFFER_SIZE)

        ZipInputStream(inputStream.buffered(BUFFER_SIZE)).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                val destFile = File(destDir, entry.name)

                // Zip-slip protection: ensure the resolved path is within destDir
                val canonicalDest = destFile.canonicalPath
                val canonicalDir = destDir.canonicalPath
                if (!canonicalDest.startsWith("$canonicalDir${File.separator}") && canonicalDest != canonicalDir) {
                    throw SecurityException("Zip entry is outside of the target dir: ${entry.name}")
                }

                if (entry.isDirectory) {
                    destFile.mkdirs()
                } else {
                    // Ensure parent directories exist
                    destFile.parentFile?.mkdirs()

                    BufferedOutputStream(FileOutputStream(destFile), BUFFER_SIZE).use { bos ->
                        var bytesRead: Int
                        while (zis.read(buffer).also { bytesRead = it } != -1) {
                            bos.write(buffer, 0, bytesRead)
                            bytesExtracted += bytesRead
                            listener?.onProgress(bytesExtracted, totalZipSize, entry!!.name)
                        }
                    }

                    extractedFiles.add(destFile.absolutePath)
                }

                zis.closeEntry()
                entry = zis.nextEntry
            }
        }

        return ExtractionResult(extractedFiles, bytesExtracted)
    }
}
