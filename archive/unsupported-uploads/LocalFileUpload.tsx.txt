'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

interface LocalFileUploadProps {
  onUploadComplete: (url: string) => void
  maxSize?: number // MB
  accept?: Record<string, string[]>
}

export default function LocalFileUpload({ 
  onUploadComplete, 
  maxSize = 10,
  accept = {
    'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
    'application/pdf': ['.pdf']
  }
}: LocalFileUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    // 文件大小检查
    if (file.size > maxSize * 1024 * 1024) {
      setError(`文件过大，最大支持 ${maxSize}MB`)
      return
    }

    setError(null)
    setUploading(true)

    // 显示预览
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => setPreview(reader.result as string)
      reader.readAsDataURL(file)
    }

    try {
      // 读取文件
      const arrayBuffer = await file.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)

      // 上传到本地服务器
      const response = await fetch('/anonyproof/api/upload-local', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': file.name,
          'X-Content-Type': file.type
        },
        body: uint8Array
      })

      const data = await response.json()

      if (data.success && data.file && data.file.url) {
        onUploadComplete(data.file.url)
        setPreview(null)
      } else {
        throw new Error(data.error || '上传失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
      setPreview(null)
    } finally {
      setUploading(false)
    }
  }, [onUploadComplete, maxSize])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    maxSize: maxSize * 1024 * 1024,
    accept
  })

  return (
    <div>
      <div
        {...getRootProps()}
        style={{
          border: '2px dashed',
          borderColor: isDragActive ? '#667eea' : '#ccc',
          borderRadius: '8px',
          padding: '16px',
          textAlign: 'center',
          cursor: 'pointer',
          background: isDragActive ? 'rgba(102, 126, 234, 0.05)' : 'transparent'
        }}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <p style={{ fontSize: '14px', color: '#667eea' }}>⏳ 上传中...</p>
        ) : preview ? (
          <div>
            <img src={preview} alt="预览" style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '8px' }} />
          </div>
        ) : (
          <p style={{ fontSize: '14px', color: '#86868b' }}>
            {isDragActive ? '📂 释放文件上传' : '📎 拖拽文件到此处，或点击选择'}
          </p>
        )}
        <p style={{ fontSize: '12px', color: '#86868b', marginTop: '8px' }}>
          支持图片、PDF (最大 {maxSize}MB)
        </p>
      </div>
      {error && (
        <p style={{ color: '#ff3b30', fontSize: '13px', marginTop: '8px' }}>
          ❌ {error}
        </p>
      )}
    </div>
  )
}
