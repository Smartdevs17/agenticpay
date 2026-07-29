"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Check, QrCode, Share2, Code, Download, Twitter, Send, Mail } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface LinkShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  slug: string;
  description?: string;
}

export function LinkShareModal({ isOpen, onClose, slug, description }: LinkShareModalProps) {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [campaignSource, setCampaignSource] = useState("direct");

  const baseUrl = `https://pay.agenticpay.com/r/${slug}`;
  const shareUrl = campaignSource && campaignSource !== "direct"
    ? `${baseUrl}?source=${encodeURIComponent(campaignSource)}`
    : baseUrl;

  const encodedUrl = encodeURIComponent(shareUrl);
  const shareText = encodeURIComponent("Pay securely via AgenticPay Link");

  const socialLinks = [
    { name: "Twitter / X", icon: Twitter, href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${shareText}`, color: "bg-black text-white hover:bg-gray-800" },
    { name: "WhatsApp", icon: Share2, href: `https://wa.me/?text=${shareText}%20${encodedUrl}`, color: "bg-emerald-600 text-white hover:bg-emerald-700" },
    { name: "Telegram", icon: Send, href: `https://t.me/share/url?url=${encodedUrl}&text=${shareText}`, color: "bg-sky-500 text-white hover:bg-sky-600" },
    { name: "Email", icon: Mail, href: `mailto:?subject=Payment%20Link&body=${shareText}%0A%0A${encodedUrl}`, color: "bg-gray-700 text-white hover:bg-gray-800" },
  ];

  const embedCode = `<iframe src="${shareUrl}" width="100%" height="600" frameborder="0" allow="payment"></iframe>`;

  const copyToClipboard = (text: string, type: "url" | "embed") => {
    navigator.clipboard.writeText(text);
    if (type === "url") {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } else {
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 2000);
    }
  };

  const downloadQrCode = () => {
    const svgElement = document.getElementById("payment-link-qr-svg");
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const SVGURL = window.URL.createObjectURL(svgBlob);
    const downloadLink = document.createElement("a");
    downloadLink.href = SVGURL;
    downloadLink.download = `qr-${slug}.svg`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Share2 className="h-5 w-5 text-blue-500" /> Share Payment Link & QR Code
          </DialogTitle>
          <DialogDescription>
            {description || "Share your payment link across social channels, generate QR codes, or embed checkouts."}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="share" className="w-full mt-2">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="share" className="flex items-center gap-2">
              <Share2 className="h-4 w-4" /> Share Link
            </TabsTrigger>
            <TabsTrigger value="qr" className="flex items-center gap-2">
              <QrCode className="h-4 w-4" /> QR Code
            </TabsTrigger>
            <TabsTrigger value="embed" className="flex items-center gap-2">
              <Code className="h-4 w-4" /> Embed
            </TabsTrigger>
          </TabsList>

          <TabsContent value="share" className="space-y-4 pt-4">
            <div>
              <Label className="text-xs font-medium text-gray-500">Campaign Traffic Source (UTM Tag)</Label>
              <div className="flex items-center gap-2 mt-1">
                {["direct", "newsletter", "twitter", "facebook", "email"].map((src) => (
                  <Button
                    key={src}
                    type="button"
                    variant={campaignSource === src ? "default" : "outline"}
                    size="sm"
                    className="capitalize text-xs h-7"
                    onClick={() => setCampaignSource(src)}
                  >
                    {src}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs font-medium text-gray-500">Payment Link URL</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input value={shareUrl} readOnly className="font-mono text-sm" />
                <Button onClick={() => copyToClipboard(shareUrl, "url")} className="gap-2 shrink-0">
                  {copiedUrl ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  {copiedUrl ? "Copied!" : "Copy"}
                </Button>
              </div>
            </div>

            <div className="pt-2">
              <Label className="text-xs font-medium text-gray-500 mb-2 block">Quick Social Share</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {socialLinks.map((s) => {
                  const Icon = s.icon;
                  return (
                    <a
                      key={s.name}
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-2 p-2.5 rounded-lg font-medium text-xs transition-opacity hover:opacity-90 ${s.color}`}
                    >
                      <Icon className="h-4 w-4" />
                      {s.name}
                    </a>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="qr" className="space-y-4 pt-4 text-center">
            <div className="flex flex-col items-center justify-center p-6 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-100 dark:border-gray-800">
              <QRCodeSVG
                id="payment-link-qr-svg"
                value={shareUrl}
                size={220}
                level="H"
                includeMargin={true}
              />
              <p className="text-xs text-gray-500 mt-3 font-mono">/r/{slug}</p>
            </div>
            <Button onClick={downloadQrCode} variant="outline" className="w-full gap-2">
              <Download className="h-4 w-4" /> Download SVG QR Code
            </Button>
          </TabsContent>

          <TabsContent value="embed" className="space-y-4 pt-4">
            <div>
              <Label className="text-xs font-medium text-gray-500">HTML Iframe Embed Code</Label>
              <textarea
                value={embedCode}
                readOnly
                rows={4}
                className="w-full mt-1 p-3 rounded-lg font-mono text-xs border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none"
              />
            </div>
            <Button onClick={() => copyToClipboard(embedCode, "embed")} variant="outline" className="w-full gap-2">
              {copiedEmbed ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              {copiedEmbed ? "Copied Embed Code!" : "Copy HTML Embed Code"}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
