'use client';
import { useParams } from 'next/navigation';
import { ProductForm } from '../../../../../components/product-form';

export default function EditProductPage() {
  const params = useParams();
  const id = String(params.id);
  return <ProductForm mode="edit" productId={id} />;
}
