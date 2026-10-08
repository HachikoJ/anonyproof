// 图床上传工具

export async function uploadToImageHost(file: File): Promise<string> {
  try {
    // 使用 imgbb 免费图床
    const formData = new FormData()
    formData.append('image', file)
    
    // 使用公开的 imgbb API key（实际使用时应该替换为您的专用key）
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.NEXT_PUBLIC_IMGBB_KEY || 'your_api_key_here'}`, {
      method: 'POST',
      body: formData
    })
    
    const data = await response.json()
    
    if (data.success && data.data && data.data.url) {
      return data.data.url
    } else {
      throw new Error('上传失败')
    }
  } catch (error) {
    console.error('图床上传失败:', error)
    throw error
  }
}

// 备选方案：使用 imguran（需要API key）
export async function uploadToImgur(file: File): Promise<string> {
  try {
    const formData = new FormData()
    formData.append('image', file)
    
    const response = await fetch('https://api.imgur.com/3/image', {
      method: 'POST',
      headers: {
        'Authorization': `Client-ID ${process.env.NEXT_PUBLIC_IMGUR_CLIENT_ID || 'your_client_id'}`
      },
      body: formData
    })
    
    const data = await response.json()
    
    if (data.success && data.data && data.data.link) {
      return data.data.link
    } else {
      throw new Error('上传失败')
    }
  } catch (error) {
    console.error('Imgur上传失败:', error)
    throw error
  }
}

// 统一上传接口
export async function uploadImage(file: File): Promise<string> {
  // 优先使用 imgbb
  try {
    return await uploadToImageHost(file)
  } catch (error) {
    console.error('主要图床失败，尝试备用方案:', error)
    // 如果失败，可以尝试其他图床或返回错误
    throw new Error('图片上传失败，请重试')
  }
}
