'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

interface FileUploadProps {
  onUploadComplete: (url: string) => void
  maxSize?: number // MB
  accept?: string[]
}

export default function FileUpload({ 
  onUploadComplete, 
  maxSize = 10, 
  accept = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] 
}: FileUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    setError(null)
    setUploading(true)

    // 显示预览
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => setPreview(reader.result as string)
      reader.readAsDataURL(file)
    }

    try {
      // 上传到图床
      const formData = new FormData()
      formData.append('image', file)

      // 使用 imgbb API
      const apiKey = process.env.NEXT_PUBLIC_IMGBB_KEY || 'demo'
      const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
        method: 'POST',
        body: formData
      })

      const data = await response.json()

      if (data.success && data.data && data.data.url) {
        onUploadComplete(data.data.url)
        setPreview(null)
      } else {
        throw new Error('上传失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
      setPreview(null)
    } finally {
      setUploading(false)
    }
  }, [onUploadComplete])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    maxSize: maxSize * 1024 * 1024,
    accept: accept.reduce((acc, type) => ({ ...acc, [type]: [] }), {})
  })

  return (
    <div>
      <div
        {...getRootProps()}
        style={{
          border: '2px dashed',
          borderColor: isDragActive ? '#667eea' : '#ccc',
          borderRadius: '8px',
          padding: '20px',
          textAlign: 'center',
          cursor: 'pointer',
          background: isDragActive ? 'rgba(102, 126, 234, 0.05)' : 'transparent'
        }}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <p>上传中... ⏳</p>
        ) : preview ? (
          <div>
            <img src={preview} alt="预览" style={{ maxWidth: '100%', maxHeight: '200px' }} />
          </div>
        ) : (
          <p>
            {isDragActive ? '释放文件上传' : '拖拽文件到此处，或点击选择文件'}
          </p>
        )}
        <p style={{ fontSize: '12px', color: '#86868b', marginTop: '8px' }}>
          支持格式: {accept.join(', ')} (最大 {maxSize}MB)
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
