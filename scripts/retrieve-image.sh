#!/bin/bash
#
# ImageRetriever Helper Script
# 
# This script provides an easy way to call the ImageRetriever tool
# with common defaults and helpful prompts.
#
# Usage:
#   ./scripts/retrieve-image.sh
#   (follow the interactive prompts)
#
# Or with arguments:
#   ./scripts/retrieve-image.sh "search query" landscape "context description" "./output/path"
#

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the script's directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
IMAGE_RETRIEVER_DIR="$PROJECT_ROOT/ImageRetriever"

echo -e "${GREEN}=== ImageRetriever Helper Script ===${NC}\n"

# Check if ImageRetriever exists
if [ ! -d "$IMAGE_RETRIEVER_DIR" ]; then
    echo -e "${RED}Error: ImageRetriever directory not found at: $IMAGE_RETRIEVER_DIR${NC}"
    exit 1
fi

# Check if we have arguments or need to prompt
if [ $# -eq 0 ]; then
    # Interactive mode
    echo "Interactive mode - please provide the following information:"
    echo ""
    
    # Query
    read -p "Search query (e.g., 'bakery fresh bread'): " QUERY
    if [ -z "$QUERY" ]; then
        echo -e "${RED}Error: Query is required${NC}"
        exit 1
    fi
    
    # Shape
    echo ""
    echo "Image shape options:"
    echo "  1) landscape - Wide images for headers/banners"
    echo "  2) portrait  - Tall images for sidebars"
    echo "  3) square    - Square images for icons/profiles"
    read -p "Select shape (1-3): " SHAPE_CHOICE
    
    case $SHAPE_CHOICE in
        1) SHAPE="landscape" ;;
        2) SHAPE="portrait" ;;
        3) SHAPE="square" ;;
        *)
            echo -e "${RED}Invalid choice. Using 'landscape' as default.${NC}"
            SHAPE="landscape"
            ;;
    esac
    
    # Context
    echo ""
    read -p "Context description (e.g., business description): " CONTEXT
    if [ -z "$CONTEXT" ]; then
        echo -e "${YELLOW}Warning: No context provided. Image relevance may be lower.${NC}"
        CONTEXT="No context provided"
    fi
    
    # Output path
    echo ""
    read -p "Output directory (default: $IMAGE_RETRIEVER_DIR/downloads): " OUTPUT
    if [ -z "$OUTPUT" ]; then
        OUTPUT="$IMAGE_RETRIEVER_DIR/downloads"
    fi
    
    # Turns
    echo ""
    read -p "Maximum retrieval turns (default: 5, range: 1-10): " TURNS
    if [ -z "$TURNS" ]; then
        TURNS=5
    fi
    
else
    # Command line mode
    QUERY="$1"
    SHAPE="${2:-landscape}"
    CONTEXT="${3:-No context provided}"
    OUTPUT="${4:-$IMAGE_RETRIEVER_DIR/downloads}"
    TURNS="${5:-5}"
fi

# Validate shape
if [[ ! "$SHAPE" =~ ^(landscape|portrait|square)$ ]]; then
    echo -e "${RED}Error: Invalid shape '$SHAPE'. Must be landscape, portrait, or square.${NC}"
    exit 1
fi

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT"

# Display configuration
echo ""
echo -e "${GREEN}Configuration:${NC}"
echo "  Query:   $QUERY"
echo "  Shape:   $SHAPE"
echo "  Context: $CONTEXT"
echo "  Output:  $OUTPUT"
echo "  Turns:   $TURNS"
echo ""

# Confirm
read -p "Proceed with image retrieval? (y/n): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Change to ImageRetriever directory
cd "$IMAGE_RETRIEVER_DIR" || exit 1

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing ImageRetriever dependencies...${NC}"
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}Error: Failed to install dependencies${NC}"
        exit 1
    fi
fi

# Run the ImageRetriever
echo ""
echo -e "${GREEN}Starting image retrieval...${NC}"
echo ""

npm start -- \
    --query "$QUERY" \
    --shape "$SHAPE" \
    --context "$CONTEXT" \
    --output "$OUTPUT" \
    --turns "$TURNS"

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ Image retrieval completed successfully!${NC}"
    echo "  Check output directory: $OUTPUT"
else
    echo -e "${RED}✗ Image retrieval failed with exit code $EXIT_CODE${NC}"
fi

exit $EXIT_CODE





