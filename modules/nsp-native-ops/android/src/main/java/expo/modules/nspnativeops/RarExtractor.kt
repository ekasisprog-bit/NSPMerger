package expo.modules.nspnativeops

import net.sf.sevenzipjbinding.*
import net.sf.sevenzipjbinding.impl.RandomAccessFileInStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile

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

        val raf = RandomAccessFile(rarFile, "r")
        val inStream = RandomAccessFileInStream(raf)

        try {
            val inArchive = SevenZip.openInArchive(null, inStream)

            try {
                val itemCount = inArchive.numberOfItems

                for (i in 0 until itemCount) {
                    val isDir = inArchive.getProperty(i, PropID.IS_FOLDER) as? Boolean ?: false
                    val path = inArchive.getProperty(i, PropID.PATH) as? String ?: continue

                    val entryName = path.replace("\\", "/")

                    // Zip-slip protection
                    val destFile = File(destDir, entryName)
                    val canonicalDest = destFile.canonicalPath
                    val canonicalDir = destDir.canonicalPath
                    if (!canonicalDest.startsWith("$canonicalDir${File.separator}") && canonicalDest != canonicalDir) {
                        throw SecurityException("Archive entry is outside of the target dir: $entryName")
                    }

                    if (isDir) {
                        destFile.mkdirs()
                        continue
                    }

                    destFile.parentFile?.mkdirs()

                    val result = IntArray(1)
                    inArchive.extract(intArrayOf(i), false, object : IArchiveExtractCallback {
                        private var outputStream: BufferedOutputStream? = null

                        override fun getStream(index: Int, extractAskMode: ExtractAskMode): ISequentialOutStream? {
                            if (extractAskMode != ExtractAskMode.EXTRACT) return null
                            outputStream = BufferedOutputStream(FileOutputStream(destFile), BUFFER_SIZE)
                            return ISequentialOutStream { data ->
                                outputStream?.write(data)
                                data.size
                            }
                        }

                        override fun prepareOperation(extractAskMode: ExtractAskMode) {}

                        override fun setOperationResult(extractOperationResult: ExtractOperationResult) {
                            outputStream?.close()
                            outputStream = null
                            if (extractOperationResult != ExtractOperationResult.OK) {
                                result[0] = -1
                            }
                        }

                        override fun setTotal(total: Long) {}

                        override fun setCompleted(complete: Long) {}
                    })

                    if (result[0] == -1) {
                        continue
                    }

                    val fileSize = destFile.length()
                    bytesExtracted += fileSize
                    extractedFiles.add(destFile.absolutePath)

                    listener?.onProgress(bytesExtracted, totalBytes, entryName)
                }
            } finally {
                inArchive.close()
            }
        } finally {
            inStream.close()
            raf.close()
        }

        return ExtractionResult(extractedFiles, bytesExtracted)
    }
}
