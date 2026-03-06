package expo.modules.nspnativeops

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.StatFs
import android.provider.DocumentsContract
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

class NspNativeOpsModule : Module() {

    companion object {
        private const val TAG = "NspNativeOps"
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
            if (activity == null) {
                promise.reject(CodedException("NO_ACTIVITY", "No current activity", null))
                return@AsyncFunction
            }

            pendingPickPromise = promise

            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                )
            }

            try {
                activity.startActivityForResult(intent, PICK_DIRECTORY_REQUEST)
                Log.d(TAG, "pickDirectory: SAF intent launched")
            } catch (e: Exception) {
                pendingPickPromise = null
                promise.reject(CodedException("LAUNCH_FAILED", "Failed to launch picker: ${e.message}", e))
            }
        }

        OnActivityResult { _, payload ->
            Log.d(TAG, "OnActivityResult: requestCode=${payload.requestCode}, resultCode=${payload.resultCode}, data=${payload.data}")

            val promise = pendingPickPromise ?: run {
                Log.d(TAG, "OnActivityResult: no pending promise, ignoring")
                return@OnActivityResult
            }

            // Don't check requestCode — React Native may modify it.
            // Instead, check if we have a pending promise and a valid tree URI result.

            if (payload.resultCode != Activity.RESULT_OK) {
                pendingPickPromise = null
                promise.reject(CodedException("CANCELLED", "Directory picker cancelled", null))
                return@OnActivityResult
            }

            val treeUri = payload.data?.data
            if (treeUri == null) {
                pendingPickPromise = null
                promise.reject(CodedException("NO_URI", "No URI returned from picker", null))
                return@OnActivityResult
            }

            // Persist permissions
            try {
                val contentResolver = appContext.reactContext?.contentResolver
                contentResolver?.takePersistableUriPermission(
                    treeUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                )
                Log.d(TAG, "pickDirectory: persisted URI permissions for $treeUri")
            } catch (e: Exception) {
                Log.w(TAG, "pickDirectory: failed to persist permissions: ${e.message}")
                // Non-fatal — temporary permissions should still work
            }

            pendingPickPromise = null
            promise.resolve(treeUri.toString())
            Log.d(TAG, "pickDirectory: resolved with $treeUri")
        }

        // ── List files in a SAF directory ──

        AsyncFunction("listDirectoryFiles") { uriString: String ->
            Log.d(TAG, "listDirectoryFiles: $uriString")
            val context = appContext.reactContext
                ?: throw CodedException("NO_CONTEXT", "No React context", null)
            val treeUri = Uri.parse(uriString)
            val docId = DocumentsContract.getTreeDocumentId(treeUri)
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId)

            val files = mutableListOf<Map<String, Any>>()

            val cursor = context.contentResolver.query(
                childrenUri,
                arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
                ),
                null, null, null
            )

            if (cursor == null) {
                Log.w(TAG, "listDirectoryFiles: cursor is null for $childrenUri")
                return@AsyncFunction files
            }

            cursor.use {
                val idIndex = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                val nameIndex = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                val sizeIndex = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE)
                val mimeIndex = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)

                while (it.moveToNext()) {
                    val name = it.getString(nameIndex) ?: continue
                    val size = if (it.isNull(sizeIndex)) 0L else it.getLong(sizeIndex)
                    val mimeType = it.getString(mimeIndex) ?: "application/octet-stream"
                    val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, it.getString(idIndex))

                    files.add(mapOf(
                        "uri" to docUri.toString(),
                        "name" to name,
                        "size" to size.toDouble(), // JS numbers are doubles
                        "mimeType" to mimeType
                    ))
                    Log.d(TAG, "listDirectoryFiles: found file: $name (size=$size, mime=$mimeType)")
                }
            }

            Log.d(TAG, "listDirectoryFiles: found ${files.size} files total")
            files
        }

        // ── Copy file from SAF to cache ──

        AsyncFunction("copyToCache") { uriString: String, fileName: String ->
            Log.d(TAG, "copyToCache: $fileName from $uriString")
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
            } ?: throw CodedException("COPY_FAILED", "Cannot open input stream for $fileName", null)

            Log.d(TAG, "copyToCache: done -> ${cacheFile.absolutePath} (${cacheFile.length()} bytes)")
            cacheFile.absolutePath
        }

        // ── Copy file from cache back to SAF directory ──

        AsyncFunction("copyFromCache") { cachePath: String, destTreeUriString: String, fileName: String ->
            Log.d(TAG, "copyFromCache: $fileName to SAF")
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
            } ?: throw CodedException("COPY_FAILED", "Cannot open output stream for $fileName", null)

            Log.d(TAG, "copyFromCache: done -> $newDocUri")
            newDocUri.toString()
        }

        // ── Extract zip file ──

        AsyncFunction("extractZip") { zipPath: String, destDir: String ->
            Log.d(TAG, "extractZip: $zipPath -> $destDir")
            val context = appContext.reactContext
                ?: throw CodedException("NO_CONTEXT", "No React context", null)

            val zipFile = File(zipPath)
            if (!zipFile.exists()) {
                throw CodedException("FILE_NOT_FOUND", "Zip file not found: $zipPath", null)
            }

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
                                "bytesExtracted" to bytesExtracted.toDouble(),
                                "totalBytes" to totalBytes.toDouble(),
                                "currentEntry" to currentEntry,
                                "percentage" to if (totalBytes > 0) (bytesExtracted * 100.0 / totalBytes) else 0.0
                            ))
                        }
                    }
                }
            )

            Log.d(TAG, "extractZip: extracted ${result.extractedFiles.size} files, ${result.totalBytes} bytes")

            mapOf(
                "extractedFiles" to result.extractedFiles,
                "totalBytes" to result.totalBytes.toDouble()
            )
        }

        // ── Merge files ──

        AsyncFunction("mergeFiles") { inputPaths: List<String>, outputPath: String ->
            Log.d(TAG, "mergeFiles: ${inputPaths.size} parts -> $outputPath")
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
                                "bytesWritten" to bytesWritten.toDouble(),
                                "totalBytes" to totalBytes.toDouble(),
                                "currentPart" to currentPart,
                                "percentage" to if (totalBytes > 0) (bytesWritten * 100.0 / totalBytes) else 0.0
                            ))
                        }
                    }
                }
            )

            Log.d(TAG, "mergeFiles: done, ${result.totalBytes} bytes")

            mapOf(
                "outputPath" to result.outputPath,
                "totalBytes" to result.totalBytes.toDouble()
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
            Log.d(TAG, "deleteFiles: deleted $deleted of ${paths.size}")
            deleted
        }

        // ── Delete SAF document ──

        AsyncFunction("deleteSafDocument") { uriString: String ->
            val context = appContext.reactContext
                ?: throw CodedException("NO_CONTEXT", "No React context", null)
            val uri = Uri.parse(uriString)
            try {
                DocumentsContract.deleteDocument(context.contentResolver, uri)
            } catch (e: Exception) {
                Log.w(TAG, "deleteSafDocument: failed for $uriString: ${e.message}")
                false
            }
        }

        // ── Get free disk space ──

        AsyncFunction("getFreeDiskSpace") {
            val stat = StatFs(Environment.getDataDirectory().path)
            stat.availableBytes.toDouble()
        }

        // ── Get cache directory ──

        AsyncFunction("getCacheDir") {
            val context = appContext.reactContext
                ?: throw CodedException("NO_CONTEXT", "No React context", null)
            File(context.cacheDir, "nsp_work").apply { mkdirs() }.absolutePath
        }
    }
}
