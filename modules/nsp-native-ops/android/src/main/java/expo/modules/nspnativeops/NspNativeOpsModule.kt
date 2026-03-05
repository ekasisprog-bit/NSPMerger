package expo.modules.nspnativeops

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.StatFs
import android.provider.DocumentsContract
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

class NspNativeOpsModule : Module() {

    companion object {
        private const val PICK_DIRECTORY_REQUEST = 1001
        private const val PROGRESS_THROTTLE_MS = 500L
    }

    private var pendingPickPromise: Promise? = null

    override fun definition() = ModuleDefinition {
        Name("NspNativeOps")

        Events("onExtractProgress", "onMergeProgress")

        // ── SAF Directory Picker ──

        AsyncFunction("pickDirectory") { promise: Promise ->
            val activity = appContext.currentActivity
                ?: throw CodedException("NO_ACTIVITY", "No current activity", null)

            pendingPickPromise = promise

            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                )
            }

            activity.startActivityForResult(intent, PICK_DIRECTORY_REQUEST)
        }

        OnActivityResult { _, payload ->
            val promise = pendingPickPromise ?: return@OnActivityResult
            pendingPickPromise = null

            if (payload.requestCode != PICK_DIRECTORY_REQUEST) return@OnActivityResult

            if (payload.resultCode != Activity.RESULT_OK || payload.data == null) {
                promise.reject(CodedException("CANCELLED", "Directory picker cancelled", null))
                return@OnActivityResult
            }

            val treeUri = payload.data?.data
            if (treeUri == null) {
                promise.reject(CodedException("NO_URI", "No URI returned", null))
                return@OnActivityResult
            }

            // Persist permissions
            val contentResolver = appContext.reactContext?.contentResolver
            contentResolver?.takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )

            promise.resolve(treeUri.toString())
        }

        // ── List files in a SAF directory ──

        AsyncFunction("listDirectoryFiles") { uriString: String ->
            val context = appContext.reactContext
                ?: throw CodedException("NO_CONTEXT", "No React context", null)
            val treeUri = Uri.parse(uriString)
            val docId = DocumentsContract.getTreeDocumentId(treeUri)
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId)

            val files = mutableListOf<Map<String, Any>>()

            context.contentResolver.query(
                childrenUri,
                arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
                ),
                null, null, null
            )?.use { cursor ->
                val idIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                val nameIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE)
                val mimeIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)

                while (cursor.moveToNext()) {
                    val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, cursor.getString(idIndex))
                    files.add(mapOf(
                        "uri" to docUri.toString(),
                        "name" to cursor.getString(nameIndex),
                        "size" to cursor.getLong(sizeIndex),
                        "mimeType" to (cursor.getString(mimeIndex) ?: "application/octet-stream")
                    ))
                }
            }

            files
        }

        // ── Copy file from SAF to cache ──

        AsyncFunction("copyToCache") { uriString: String, fileName: String ->
            val context = appContext.reactContext
                ?: throw CodedException("NO_CONTEXT", "No React context", null)
            val uri = Uri.parse(uriString)
            val cacheFile = File(context.cacheDir, "nsp_work/$fileName")
            cacheFile.parentFile?.mkdirs()

            context.contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(cacheFile).use { output ->
                    val buffer = ByteArray(4 * 1024 * 1024)
                    var bytesRead: Int
                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        output.write(buffer, 0, bytesRead)
                    }
                }
            } ?: throw CodedException("COPY_FAILED", "Cannot open input stream for $uriString", null)

            cacheFile.absolutePath
        }

        // ── Copy file from cache back to SAF directory ──

        AsyncFunction("copyFromCache") { cachePath: String, destTreeUriString: String, fileName: String ->
            val context = appContext.reactContext
                ?: throw CodedException("NO_CONTEXT", "No React context", null)
            val treeUri = Uri.parse(destTreeUriString)
            val docId = DocumentsContract.getTreeDocumentId(treeUri)
            val parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)

            val newDocUri = DocumentsContract.createDocument(
                context.contentResolver,
                parentUri,
                "application/octet-stream",
                fileName
            ) ?: throw CodedException("CREATE_FAILED", "Cannot create document: $fileName", null)

            val cacheFile = File(cachePath)
            context.contentResolver.openOutputStream(newDocUri)?.use { output ->
                FileInputStream(cacheFile).use { input ->
                    val buffer = ByteArray(4 * 1024 * 1024)
                    var bytesRead: Int
                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        output.write(buffer, 0, bytesRead)
                    }
                }
            } ?: throw CodedException("COPY_FAILED", "Cannot open output stream", null)

            newDocUri.toString()
        }

        // ── Extract zip file ──

        AsyncFunction("extractZip") { zipPath: String, destDir: String ->
            val context = appContext.reactContext
                ?: throw CodedException("NO_CONTEXT", "No React context", null)

            val zipFile = File(zipPath)
            val destDirectory = File(destDir)
            val extractor = ZipExtractor(context)

            var lastProgressTime = 0L

            val result = extractor.extract(
                FileInputStream(zipFile),
                destDirectory,
                zipFile.length(),
                object : ZipExtractor.ProgressListener {
                    override fun onProgress(bytesExtracted: Long, totalBytes: Long, currentEntry: String) {
                        val now = System.currentTimeMillis()
                        if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
                            lastProgressTime = now
                            sendEvent("onExtractProgress", mapOf(
                                "bytesExtracted" to bytesExtracted,
                                "totalBytes" to totalBytes,
                                "currentEntry" to currentEntry,
                                "percentage" to if (totalBytes > 0) (bytesExtracted * 100.0 / totalBytes) else 0.0
                            ))
                        }
                    }
                }
            )

            mapOf(
                "extractedFiles" to result.extractedFiles,
                "totalBytes" to result.totalBytes
            )
        }

        // ── Merge files ──

        AsyncFunction("mergeFiles") { inputPaths: List<String>, outputPath: String ->
            val merger = FileMerger()
            var lastProgressTime = 0L

            val result = merger.merge(
                inputPaths,
                outputPath,
                object : FileMerger.ProgressListener {
                    override fun onProgress(bytesWritten: Long, totalBytes: Long, currentPart: String) {
                        val now = System.currentTimeMillis()
                        if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
                            lastProgressTime = now
                            sendEvent("onMergeProgress", mapOf(
                                "bytesWritten" to bytesWritten,
                                "totalBytes" to totalBytes,
                                "currentPart" to currentPart,
                                "percentage" to if (totalBytes > 0) (bytesWritten * 100.0 / totalBytes) else 0.0
                            ))
                        }
                    }
                }
            )

            mapOf(
                "outputPath" to result.outputPath,
                "totalBytes" to result.totalBytes
            )
        }

        // ── Delete files ──

        AsyncFunction("deleteFiles") { paths: List<String> ->
            var deleted = 0
            for (path in paths) {
                val file = File(path)
                if (file.exists()) {
                    if (file.isDirectory) {
                        file.deleteRecursively()
                    } else {
                        file.delete()
                    }
                    deleted++
                }
            }
            deleted
        }

        // ── Delete SAF document ──

        AsyncFunction("deleteSafDocument") { uriString: String ->
            val context = appContext.reactContext
                ?: throw CodedException("NO_CONTEXT", "No React context", null)
            val uri = Uri.parse(uriString)
            DocumentsContract.deleteDocument(context.contentResolver, uri)
        }

        // ── Get free disk space ──

        Function("getFreeDiskSpace") {
            val stat = StatFs(Environment.getDataDirectory().path)
            stat.availableBytes
        }

        // ── Get cache directory ──

        Function("getCacheDir") {
            val context = appContext.reactContext
                ?: throw CodedException("NO_CONTEXT", "No React context", null)
            File(context.cacheDir, "nsp_work").apply { mkdirs() }.absolutePath
        }
    }
}
